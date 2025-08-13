export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { model, messages, temperature = 0.7, max_tokens = 512 } = req.body || {};
  if (!model || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing fields' });

  const key = process.env.STRAICO_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server not configured' });

  // v1 prompt/completion as you found
  const url = process.env.STRAICO_CHAT_URL || 'https://api.straico.com/v1/prompt/completion';

  // Build a simple prompt from the chat history
  // System (optional) then each user/assistant turn, then the latest user message
  const toText = (msgs) => msgs.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const prompt = toText(messages);

  // Straico expects model and prompt for prompt/completion
  const body = {
    model,                // e.g. "openai/gpt-4o-mini"
    prompt,               // single text prompt
    temperature,
    max_tokens
    // You can add: files, image_urls, youtube_urls, display_transcripts, etc.
  };

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

    // Normalise to your front end’s expectation
    // Straico libs return something like completion.choices[0].message.content
    const reply =
      payload?.completion?.choices?.[0]?.message?.content
      ?? payload?.choices?.[0]?.message?.content
      ?? payload?.text
      ?? JSON.stringify(payload);

    return res.status(upstream.ok ? 200 : upstream.status).json({
      ok: upstream.ok,
      status: upstream.status,
      response: payload,
      choices: [{ message: { content: reply } }]
    });

  } catch (err) {
    return res.status(500).json({ error: 'Upstream error (proxy exception)', detail: String(err) });
  }
}
