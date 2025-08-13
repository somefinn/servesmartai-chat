// ServeSmartAI → Straico proxy (safe: key stays on server)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { model, messages, temperature = 0.7, max_tokens = 512, stream = false } = req.body || {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing fields: model or messages' });
  }

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured' });

  // Join your chat history into one prompt string
  const joinHistory = (msgs) =>
    msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');

  const prompt = joinHistory(messages);

  // Prefer v1, fall back to v0 if needed
  const primaryUrl = process.env.STRAICO_CHAT_URL || 'https://api.straico.com/v1/prompt/completion';
  const fallbackUrl = 'https://api.straico.com/v0/prompt/completion';

  // Build a body that satisfies both possible shapes
  const baseBody = {
    model,                  // e.g. "openai/gpt-4o-mini" from your dropdown
    input: prompt,          // many installs expect "input"
    prompt,                 // others expect "prompt"
    message: prompt,        // some examples use "message"
    temperature,
    max_tokens,
    stream: !!stream
  };

  try {
    const first = await fetch(primaryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(baseBody)
    });

    // If v1 errors in a way that suggests wrong path or shape, try v0 automatically
    let upstream = first;
    if (!first.ok && (first.status === 404 || first.status === 422)) {
      const second = await fetch(fallbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(baseBody)
      });
      upstream = second;
    }

    const text = await upstream.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        ok: false,
        status: upstream.status,
        response: payload
      });
    }

    // Normalise likely response shapes to what your front end expects
    const candidates = [
      payload?.completion?.choices?.[0]?.message?.content,
      payload?.data?.completion?.choices?.[0]?.message?.content,
      payload?.response?.completion?.choices?.[0]?.message?.content,
      payload?.choices?.[0]?.message?.content,
      payload?.data?.choices?.[0]?.message?.content,
      payload?.output,                     // some APIs return plain "output"
      payload?.data?.output,
      payload?.text                        // some minimal shapes return "text"
    ];
    const reply = candidates.find(v => typeof v === 'string' && v.trim().length > 0)
      || (typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));

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
