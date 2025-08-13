// ServeSmartAI → Straico proxy
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { model, messages, temperature = 0.7, max_tokens = 512, stream = false } = req.body || {};
    if (!model || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing fields: model or messages' });

    const key = process.env.STRAICO_API_KEY;
    if (!key) return res.status(500).json({ error: 'Server not configured' });

    const joined = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Prefer chat endpoints for reasoning families
    const isReasoning = /(?:^|\/)(?:o1|o3|r1|grok)(?:[-:]|$)/i.test(model);

    const endpoints = [
      // chat style
      'https://api.straico.com/v1/chat/completions',
      'https://api.straico.com/v0/chat/completions',
      // prompt style
      'https://api.straico.com/v1/prompt/completion',
      'https://api.straico.com/v0/prompt/completion'
    ];

    const chatBody  = { model, messages, temperature, max_tokens, stream: !!stream };
    const msgBody   = { model, message: lastUser || joined, temperature, max_tokens, stream: !!stream };
    const promptBody= { model, prompt: joined, temperature, max_tokens, stream: !!stream };
    const inputBody = { model, input: joined, temperature, max_tokens, stream: !!stream };

    const bodies = isReasoning
      ? [chatBody, { ...chatBody, message: lastUser, prompt: joined, input: joined }, msgBody, promptBody, inputBody]
      : [chatBody, promptBody, msgBody, inputBody];

    async function call(url, body, wantStream) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify(body)
      });
      const ctype = r.headers.get('content-type') || '';
      return { r, ctype, url, bodyKeys: Object.keys(body), wantStream };
    }

    // Try combinations until one works
    let last, ok;
    for (const url of endpoints) {
      for (const body of bodies) {
        const resp = await call(url, body, !!stream);
        last = resp;
        if (resp.r.ok) { ok = resp; break; }
        if (![400,401,403,404,422].includes(resp.r.status)) continue;
      }
      if (ok) break;
    }

    if (!ok) {
      const t = await last.r.text();
      let payload; try { payload = JSON.parse(t); } catch { payload = { raw: t }; }
      return res.status(last.r.status || 500).json({
        ok: false, status: last.r.status || 500,
        tried: { url: last.url, bodyKeys: last.bodyKeys },
        response: payload
      });
    }

    // Streaming path
    if (stream) {
      // If upstream is SSE, just pipe it through
      if (ok.ctype.includes('text/event-stream')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        const reader = ok.r.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          res.write(chunk);
        }
        // end marker and model tag
        res.write(`data: ${JSON.stringify({ done: true, used_model: model })}\n\n`);
        return res.end();
      }

      // Otherwise, read fully, extract text, then simulate SSE so the UI still streams
      const text = await ok.r.text();
      let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

      const candidates = [
        payload?.completion?.choices?.[0]?.message?.content,
        payload?.data?.completion?.choices?.[0]?.message?.content,
        payload?.choices?.[0]?.message?.content,
        payload?.data?.choices?.[0]?.message?.content,
        payload?.completion?.choices?.[0]?.text,
        payload?.choices?.[0]?.text,
        payload?.output,
        payload?.data?.output,
        payload?.text
      ];
      const reply = candidates.find(v => typeof v === 'string' && v.trim()) ||
                    (typeof payload === 'string' ? payload : JSON.stringify(payload));

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      // chunk out as "delta" pieces
      const cps = 70;               // server side chunk rate
      let i = 0;
      const send = () => {
        if (i >= reply.length) {
          res.write(`data: ${JSON.stringify({ done: true, used_model: model })}\n\n`);
          return res.end();
        }
        const next = reply.slice(i, i + cps);
        i += cps;
        res.write(`data: ${JSON.stringify({ choices:[{ delta:{ content: next } }] })}\n\n`);
        setTimeout(send, 60);
      };
      send();
      return;
    }

    // Non-stream: read, normalise, return JSON
    const text = await ok.r.text();
    let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    const candidates = [
      payload?.completion?.choices?.[0]?.message?.content,
      payload?.data?.completion?.choices?.[0]?.message?.content,
      payload?.choices?.[0]?.message?.content,
      payload?.data?.choices?.[0]?.message?.content,
      payload?.completion?.choices?.[0]?.text,
      payload?.choices?.[0]?.text,
      payload?.output,
      payload?.data?.output,
      payload?.text
    ];
    const reply = candidates.find(v => typeof v === 'string' && v.trim()) ||
                  (typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));

    return res.status(200).json({
      ok: true, status: 200, used_model: model,
      response: payload,
      choices: [{ message: { content: reply } }]
    });

  } catch (err) {
    console.error('proxy_crash', err);
    return res.status(500).json({ error: 'Upstream error (proxy exception)', detail: String(err) });
  }
}
