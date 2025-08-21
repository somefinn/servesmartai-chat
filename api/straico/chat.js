// api/straico/chat.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { model, messages, stream } = req.body;

    if (!model || !messages || !messages.length) {
      return res.status(422).json({ error: "Missing message" });
    }

    // Combine messages into a single prompt (Straico v0 expects `input`)
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join("\n");

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.STRAICO_API_KEY}`
    };

    // Straico expects { model, input, stream }
    const body = JSON.stringify({
      model,
      input: prompt,
      stream: !!stream
    });

    const apiRes = await fetch("https://api.straico.com/v0/completions", {
      method: "POST",
      headers,
      body
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(apiRes.status).json({ error: errText });
    }

    const data = await apiRes.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error("Straico Proxy Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
