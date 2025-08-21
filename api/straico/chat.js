// pages/api/straico/chat.js
// Next.js (Node 18+) API route

const STRAICO_URL = "https://api.straico.com/v0/prompt/completion";
const MAX_CHARS = 18000;

// Flatten chat history into a single transcript for v0 endpoint
function toTranscript(messages = []) {
  try {
    const lines = [];
    for (const m of messages) {
      const who =
        m.role === "user"
          ? "User"
          : m.role === "assistant"
          ? "Assistant"
          : "System";
      lines.push(`${who}: ${m.content}`);
    }
    let out = lines.join("\n\n");
    if (out.length > MAX_CHARS) out = out.slice(-MAX_CHARS);
    return out;
  } catch {
    return "";
  }
}

// Optional health probe: GET /api/straico/chat?diag=1
export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.diag === "1") {
    return res
      .status(200)
      .json({ ok: true, hasKey: !!process.env.STRAICO_API_KEY });
  }

  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const key = process.env.STRAICO_API_KEY;
    if (!key) {
      console.error("[STRAICO] Missing STRAICO_API_KEY");
      return res.status(500).json({ error: "Missing STRAICO_API_KEY" });
    }

    // Expect: { model, messages, temperature?, max_output?, stream? }
    const {
      model,
      messages = [],
      temperature = 0.7,
      max_output = 1200,
      stream = false,
    } = req.body || {};

    if (!model) return res.status(400).json({ error: "Missing model" });

    // Build the v0 "single string" prompt
    const transcript = toTranscript(Array.isArray(messages) ? messages : []);
    if (!transcript) {
      return res.status(400).json({ error: "Missing message" });
    }

    // Be liberal with the upstream field name to avoid “Missing message”
    const body = {
      model,
      message: transcript,   // primary
      input: transcript,     // fallback
      prompt: transcript,    // fallback
      temperature,
      max_output,
      stream: !!stream,      // your front-end currently uses non-stream
    };

    const upstream = await fetch(STRAICO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      // Bubble up what Straico said so you see it in the chat bubble
      console.error(
        "[STRAICO] Upstream error",
        upstream.status,
        text?.slice(0, 600)
      );
      res.status(upstream.status);
      // If upstream sent JSON, forward JSON; otherwise forward text
      try {
        return res.json(JSON.parse(text));
      } catch {
        return res.send(text);
      }
    }

    // Normalise to OpenAI-like shape your front-end expects
    const content =
      data?.data?.completion?.choices?.[0]?.message?.content ||
      data?.completion?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.message?.content ||
      data?.response?.text ||
      data?.text ||
      "";

    return res.status(200).json({
      choices: [{ message: { role: "assistant", content } }],
    });
  } catch (err) {
    console.error("[STRAICO] Handler crash", err);
    return res.status(500).json({ error: "Server error" });
  }
}
