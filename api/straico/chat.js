// Vercel serverless proxy for Straico
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, messages, stream } = req.body || {};
  if (!model || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing fields' });

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured' });

  // If your Postman docs show a different path, set STRAICO_CHAT_URL in Vercel.
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

    if (!stream) {
      const data = await upstream.json();
      return res.status(upstream.ok ? 200 : upstream.status).json(data);
    }

    // Streaming passthrough if you enable it later
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(encoder.encode(value));
    }
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upstream error' });
  }
}
