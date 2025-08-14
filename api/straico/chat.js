// pages/api/straico/chat.js
const STRAICO_URL = 'https://api.straico.com/v0/prompt/completion';
const MAX_CHARS = 18000;

function toTranscript(messages = []) {
  try {
    const lines = [];
    for (const m of messages) {
      const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      lines.push(`${who}: ${m.content}`);
    }
    let out = lines.join('\n\n');
    if (out.length > MAX_CHARS) out = out.slice(-MAX_CHARS);
    return out;
  } catch (e) {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  try {
    const STRAICO_KEY = process.env.STRAICO_API_KEY;
    if (!STRAICO_KEY) {
      console.error('[STRAICO] Missing STRAICO_API_KEY');
      return res.status(500).json({ error: 'Missing STRAICO_API_KEY' });
    }

    const { model, messages, temperature = 0.7, max_output = 1200 } = req.body || {};
    if (!model) return res.status(400).json({ error: 'Missing model' });

    const message = toTranscript(Array.isArray(messages) ? messages : []);
    console.log('[STRAICO] model:', model);
    console.log('[STRAICO] transcript chars:', message.length);

    const upstream = await fetch(STRAICO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STRAICO_KEY}`
      },
      body: JSON.stringify({ model, message, temperature, max_output })
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!upstream.ok) {
      console.error('[STRAICO] Upstream error', upstream.status, text?.slice(0, 500));
      return res.status(upstream.status).send(text);
    }

    const content =
      data?.completion?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.message?.content ||
      data?.text ||
      '';

    return res.status(200).json({
      choices: [{ message: { role: 'assistant', content } }]
    });
  } catch (e) {
    console.error('[STRAICO] Handler crash', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
