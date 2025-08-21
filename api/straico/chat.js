// /api/straico/chat.js  (Straico v0, single-model, robust)

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Use POST' });
    }

    const key = process.env.STRAICO_API_KEY;
    if (!key) return res.status(500).json({ error: 'Missing STRAICO_API_KEY' });

    const { model, messages = [], stream = false } = req.body || {};

    // Clean/standardize messages from the UI
    const std = (Array.isArray(messages) ? messages : [])
      .filter(m => m && typeof m.content === 'string' && m.content.trim() !== '')
      .map(m => ({ role: m.role || 'user', content: String(m.content) }));

    // v0 is picky—send a plain `message` too
    const lastUser =
      [...std].reverse().find(m => m.role === 'user')?.content ||
      std.at(-1)?.content || '';

    // Fallback prompt transcript
    const prompt =
      std.map(m => {
        const r = m.role === 'system' ? 'System' : m.role === 'assistant' ? 'Assistant' : 'User';
        return `${r}: ${m.content}`;
      }).join('\n') + '\nAssistant:';

    const payload = {
      model,
      stream: Boolean(stream),
      messages: std,    // chat style
      message: lastUser, // v0 single message
      prompt            // safety fallback
    };

    const upstream = await fetch('https://api.straico.com/v0/prompt/completion', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const raw = await upstream.text();
    let data; try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!upstream.ok) {
      // Show real upstream error so you can see it in the bubble
      return res.status(upstream.status).json(data);
    }

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
    // Always return a response so the UI never shows “Network error”
    return res.status(500).json({ error: String(err && err.message || err) });
  }
};
