export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured' });

  const url = 'https://api.straico.com/v0/models';

  try {
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${key}` } });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Upstream error', detail: String(e) });
  }
}
