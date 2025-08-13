// ServeSmartAI → Straico proxy (safe: key stays on server)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, messages, temperature = 0.7, max_tokens = 512, stream = false } = req.body || {};
  if (!model || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing fields: model or messages' });

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured' });

  // Join chat history into one prompt string
  const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

  // Endpoints: try v1 then fall back to v0
  const urls = [
    process.env.STRAICO_CHAT_URL || 'https://api.straico.com/v1/prompt/completion',
    'https://api.straico.com/v0/prompt/completion'
  ];

  export const maxDuration = 60; // seconds

const isReasoning = /(?:^|\/)(?:o1|o3|grok|r1)(?:-|:|$)/i.test(model);

// Create a concentrated body that satisfies both shapes for reasoning models
const joined = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';

const bodies = isReasoning
  ? [
      { model, messages, message: lastUser, prompt: joined, input: joined, temperature, max_tokens, stream: !!stream },
      { model, messages, temperature, max_tokens, stream: !!stream },
      { model, message: lastUser, temperature, max_tokens, stream: !!stream },
      { model, prompt: joined, temperature, max_tokens, stream: !!stream },
      { model, input: joined, temperature, max_tokens, stream: !!stream }
    ]
  : [
      { model, prompt: joined, temperature, max_tokens, stream: !!stream },
      { model, message: joined, temperature, max_tokens, stream: !!stream },
      { model, input: joined, temperature, max_tokens, stream: !!stream },
      { model, messages, temperature, max_tokens, stream: !!stream }
    ];

  async function call(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    return { ok: r.ok, status: r.status, payload };
  }

  try {
    // Try all combinations until one works
    let last = null;
    let success = null;

    for (const url of urls) {
      for (const body of bodies) {
        const resp = await call(url, body);
        last = { url, body, ...resp };
        if (resp.ok) { success = last; break; }
        // If it’s clearly “wrong shape”, move on; otherwise keep last error
        if (![400, 401, 403, 404, 422].includes(resp.status)) continue;
      }
      if (success) break;
    }

    if (!success) {
      // Surface the most recent error details to the client for visibility
      return res.status(last?.status || 500).json({
        ok: false,
        status: last?.status || 500,
        tried: { url: last?.url, bodyKeys: Object.keys(last?.body || {}) },
        response: last?.payload || { error: 'Unknown upstream failure' }
      });
    }

    const payload = success.payload;

    // Normalise reply to front-end shape
    const candidates = [
      payload?.completion?.choices?.[0]?.message?.content,
      payload?.data?.completion?.choices?.[0]?.message?.content,
      payload?.choices?.[0]?.message?.content,
      payload?.data?.choices?.[0]?.message?.content,
      payload?.output,
      payload?.data?.output,
      payload?.text
    ];
    const reply = candidates.find(v => typeof v === 'string' && v.trim()) ||
                  (typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));

    return res.status(200).json({
      ok: true,
      status: 200,
      response: payload,
      choices: [{ message: { content: reply } }]
    });

  } catch (err) {
    return res.status(500).json({ error: 'Upstream error (proxy exception)', detail: String(err) });
  }
}
