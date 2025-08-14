// pages/api/straico/chat.ts
import type { NextApiRequest, NextApiResponse } from "next";

const STRAICO_URL = "https://api.straico.com/v0/prompt/completion";
const STRAICO_KEY = process.env.STRAICO_API_KEY!;
const MAX_CHARS = 18000;

function toTranscript(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>) {
  const lines: string[] = [];
  for (const m of messages) {
    const who = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
    lines.push(`${who}: ${m.content}`);
  }
  let out = lines.join("\n\n");
  if (out.length > MAX_CHARS) out = out.slice(-MAX_CHARS);
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    if (!STRAICO_KEY) return res.status(500).json({ error: "Missing STRAICO_API_KEY" });

    const { model, messages, stream = false, temperature = 0.7, max_output = 1200 } = req.body || {};
    const message = toTranscript(Array.isArray(messages) ? messages : []);
    const body = JSON.stringify({ model, message, temperature, max_output });

    const r = await fetch(STRAICO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${STRAICO_KEY}`
      },
      body
    });

    const data = await r.json().catch(() => ({} as any));
    if (!r.ok) {
      const err = data?.error ?? data ?? "Upstream error";
      return res.status(r.status).json({ error: err });
    }

    const content =
      data?.completion?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.message?.content ??
      data?.text ?? "";

    return res.status(200).json({
      choices: [{ message: { role: "assistant", content } }]
    });

  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
