export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, messages, stream } = req.body || {};
  if (!model || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing fields' });

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured' });

  const url = process.env.STRAICO_CHAT_URL || 'https://stapi.straico.com/v0/chat/completions';

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({ model, messages, stream: !!stream })
    });

    const text = await upstream.text();
    // Try to parse JSON, otherwise pass raw text through so we can see the real error
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

    return res.status(upstream.ok ? 200 : upstream.status).json({
      ok: upstream.ok,
      status: upstream.status,
      url,
      model,
      response: payload
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Upstream error (proxy exception)', detail: String(err) });
  }
}
