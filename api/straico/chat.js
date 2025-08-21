// api/straico/chat.js
// Works on Vercel serverless AND Next.js API routes

const STRAICO_URL = "https://api.straico.com/v0/prompt/completion";

module.exports = async (req, res) => {
  // ---- CORS (simple) ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // ---- Parse body robustly (Vercel serverless doesn't auto-parse) ----
  let body = {};
  try {
    if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
      body = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { model, messages, stream } = body || {};
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return res.status(422).json({ error: "Missing message" });
  }

  // ---- Build single prompt that Straico v0 expects ----
  const input = messages.map(m => `${m.role}: ${m.content}`).join("\n");

  try {
    const r = await fetch(STRAICO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.STRAICO_API_KEY || ""}`,
      },
      body: JSON.stringify({
        model,
        input,
        stream: !!stream, // your UI can still set stream:false
      }),
    });

    const text = await r.text();
    if (!r.ok) {
      // Bubble up Straico error text so you can see it in UI
      return res.status(r.status).json({ error: text || `Upstream error ${r.status}` });
    }

    // Straico responses vary slightly; pull the best-guess text
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    const replyText =
      data?.response?.text ??
      data?.text ??
      data?.choices?.[0]?.text ??
      (typeof data === "string" ? data : "") ??
      "";

    // Normalize to OpenAI-like shape your front-end already reads
    return res.status(200).json({
      choices: [
        { message: { content: replyText } }
      ],
      // keep the raw around for debugging if you want
      raw: data,
    });
  } catch (err) {
    console.error("Straico proxy error:", err);
    return res.status(500).json({ error: "Proxy error" });
  }
};
