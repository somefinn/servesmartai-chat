// /api/straico/chat.js
// Single-model call via Straico v0, with robust fallbacks + normalization.
// Expects body: { model, messages:[{role,content}], stream:false }

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  try {
    const { model = 'openai/gpt-4o-mini', messages = [], stream = false } = req.body || {};

    if (!process.env.STRAICO_API_KEY) {
      return res.status(500).json({ error: 'Missing STRAICO_API_KEY on server' });
    }

    // Build a safe prompt for v0/prompt/completion (some providers expect a single prompt string)
    const prompt =
      (messages || [])
        .map(m => {
          const r = (m?.role || 'user').toUpperCase();
          const c = (m?.content ?? '').toString();
          return `${r}: ${c}`;
        })
        .join('\n\n') + '\n\nASSISTANT:';

    const headers = {
      'Authorization': `Bearer ${process.env.STRAICO_API_KEY}`,
      'Content-Type': 'application/json'
    };

    // --- Try the v0 "prompt completion" shape first ---
    const body1 = JSON.stringify({ model, prompt, stream: !!stream });
    let apiRes = await fetch('https://api.straico.com/v0/prompt/completion', {
      method: 'POST',
      headers,
      body: body1
    });

    let raw1 = await apiRes.text();
    let data1; try { data1 = JSON.parse(raw1); } catch { data1 = null; }

    // Helper to normalize any response into {choices:[{message:{content}}]}
    const normalize = (d) =>
      d?.choices?.[0]?.message?.content ||
      d?.response?.completion?.choices?.[0]?.message?.content ||
      d?.response?.text ||
      d?.text ||
      d?.choices?.[0]?.text ||
      '';

    if (apiRes.ok) {
      const content = normalize(data1);
      return res.status(200).json({ choices: [{ message: { content } }] });
    }

    // If v0/prompt/completion didn’t like our shape (e.g. 422), try a chat-style fallback.
    const body2 = JSON.stringify({ model, messages, stream: false });
    const apiRes2 = await fetch('https://api.straico.com/v0/chat/completions', {
      method: 'POST',
      headers,
      body: body2
    });

    const raw2 = await apiRes2.text();
    let data2; try { data2 = JSON.parse(raw2); } catch { data2 = null; }

    if (apiRes2.ok) {
      const content = normalize(data2);
      return res.status(200).json({ choices: [{ message: { content } }] });
    }

    // Both attempts failed — return upstream error so the UI can show it
    return res
      .status(apiRes2.status || apiRes.status || 500)
      .json({ error: (data2?.error || data1?.error || raw2 || raw1 || 'Upstream error') });

  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
};
