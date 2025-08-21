export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing STRAICO_API_KEY' });

  const { model, messages = [], stream = false } = req.body || {};

  // 1) Clean + standardize incoming messages
  const std = (Array.isArray(messages) ? messages : [])
    .filter(m => m && typeof m.content === 'string' && m.content.trim() !== '')
    .map(m => ({ role: m.role || 'user', content: String(m.content) }));

  // 2) Build fields that v0 will accept no matter what
  const lastUser =
    [...std].reverse().find(m => m.role === 'user')?.content ||
    std.at(-1)?.content || '';

  // A simple transcript prompt as a fallback
  const prompt =
    std
      .map(m => `${m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
      .join('\n') + '\nAssistant:';

  // 3) Payload: include everything v0 might look for
  const payload = {
    model,
    stream: Boolean(stream),
    // send all of them; v0 will pick what it needs
    messages: std,         // chat-style
    message: lastUser,     // single message (what v0 often requires)
    prompt                  // plain prompt fallback
  };

  try {
    const resp = await fetch('https://api.straico.com/v0/prompt/completion', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const raw = await resp.text();
    let data; try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!resp.ok) {
      // Bubble up the exact upstream error so you can see what's wrong
      return res.status(resp.status).json(data);
    }

    // 4) Normalize the response to your front-end’s shape
    const text =
      data?.choices?.[0]?.message?.content ??
      data?.response?.completion?.choices?.[0]?.message?.content ??
      data?.response?.text ??
      data?.text ??
      data?.message ??
      '';

    return res.status(200).json({
      choices: [{ message: { content: String(text) } }]
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
