// api/straico/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const STRAICO_API_KEY = process.env.STRAICO_API_KEY;
  if (!STRAICO_API_KEY) {
    res.status(500).json({ error: 'Missing STRAICO_API_KEY' });
    return;
  }

  let model, messages, stream;
  try {
    ({ model, messages, stream } = req.body || {});
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  if (!model || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Body must include { model, messages[] }' });
    return;
  }

  try {
    // v0 (single model). We force stream:false; the front-end streams via SSE only if the upstream does.
    const upstream = await fetch('https://api.straico.com/v0/prompt/completion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${STRAICO_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
      }),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      console.error('Straico upstream error', upstream.status, text);
      // Return the upstream error verbatim so the UI shows it (not "Network error").
      res.status(upstream.status).send(text);
      return;
    }

    // Parse if JSON; if not, pass through inside a normalized envelope.
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { response: { text } };
    }

    // Normalize to {choices:[{message:{content}}]} for the front-end.
    let content =
      data?.choices?.[0]?.message?.content ??
      data?.response?.completion?.choices?.[0]?.message?.content ??
      data?.response?.text ??
      data?.text ??
      '';

    if (!content || typeof content !== 'string') {
      content = typeof data === 'string' ? data : JSON.stringify(data);
    }

    res.status(200).json({ choices: [{ message: { content } }] });
  } catch (err) {
    console.error('Proxy error', err);
    res.status(502).json({ error: (err && err.message) || String(err) });
  }
}
