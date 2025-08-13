// /api/straico/chat.js
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { model, messages, temperature = 0.7, max_tokens = 512, stream = false } = req.body || {};
    if (!model || !Array.isArray(messages)) return res.status(400).json({ error: 'Missing fields: model or messages' });

    const key = process.env.STRAICO_API_KEY;
    if (!key) return res.status(500).json({ error: 'Server not configured' });

    const joined   = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || joined || 'Reply to the user.';

    // Try chat first for reasoning, then prompt; for others try both.
    const endpoints = [
      'https://api.straico.com/v1/chat/completions',
      'https://api.straico.com/v0/chat/completions',
      'https://api.straico.com/v1/prompt/completion',
      'https://api.straico.com/v0/prompt/completion'
    ];

    // helpers to build the right body for each endpoint
    const bodyFor = (url) => {
      const base = { model, temperature, max_tokens, stream: !!stream };
      if (url.includes('/chat/')) {
        return [
          { ...base, messages },                          // must include messages for chat API
          { ...base, messages, prompt: joined },          // lenient variant
        ];
      } else {
        // prompt API must receive a single field named message (or prompt/input as fallbacks)
        return [
          { ...base, message: lastUser },                 // strict expectation
          { ...base, prompt: joined },
          { ...base, input: joined },
          { ...base, message: joined, messages }          // belt and braces
        ];
      }
    };

    async function tryCall(url, body){
      const r = await fetch(url, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
        body: JSON.stringify(body)
      });
      const ctype = r.headers.get('content-type') || '';
      return { r, ctype, url, bodyKeys:Object.keys(body) };
    }

    let ok = null, last = null;

    outer: for (const url of endpoints) {
      for (const b of bodyFor(url)) {
        const resp = await tryCall(url, b);
        last = resp;
        if (resp.r.ok) { ok = resp; break outer; }
        // shape errors, keep trying; other statuses propagate later
        if (![400,401,403,404,422].includes(resp.r.status)) continue;
      }
    }

    if (!ok) {
      const t = await (last?.r?.text?.() ?? Promise.resolve(''));
      let payload; try { payload = JSON.parse(t); } catch { payload = { raw: t }; }
      return res.status(last?.r?.status || 500).json({
        ok:false, status:last?.r?.status || 500,
        tried:{ url:last?.url, bodyKeys:last?.bodyKeys },
        response: payload
      });
    }

    // Streaming passthrough or simulation
    if (stream) {
      if (ok.ctype.includes('text/event-stream')) {
        res.writeHead(200, {
          'Content-Type':'text/event-stream',
          'Cache-Control':'no-cache, no-transform',
          'Connection':'keep-alive',
          'X-Accel-Buffering':'no'
        });
        const reader = ok.r.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          res.write(dec.decode(value));
        }
        res.write(`data: ${JSON.stringify({ done:true, used_model:model })}\n\n`);
        return res.end();
      }

      // No SSE upstream: read fully, then simulate SSE so the UI still types
      const raw = await ok.r.text();
      let payload; try { payload = JSON.parse(raw); } catch { payload = { raw } };
      const candidates = [
        payload?.completion?.choices?.[0]?.message?.content,
        payload?.data?.completion?.choices?.[0]?.message?.content,
        payload?.choices?.[0]?.message?.content,
        payload?.choices?.[0]?.text,
        payload?.text, payload?.output
      ];
      const reply = candidates.find(v => typeof v === 'string' && v.trim()) || JSON.stringify(payload);

      res.writeHead(200, {
        'Content-Type':'text/event-stream',
        'Cache-Control':'no-cache, no-transform',
        'Connection':'keep-alive',
        'X-Accel-Buffering':'no'
      });
      let i = 0, step = 80;
      const send = () => {
        if (i >= reply.length) { res.write(`data: ${JSON.stringify({ done:true, used_model:model })}\n\n`); return res.end(); }
        const next = reply.slice(i, i + step); i += step;
        res.write(`data: ${JSON.stringify({ choices:[{ delta:{ content: next } }] })}\n\n`);
        setTimeout(send, 55);
      };
      return send();
    }

    // Non-stream: normalise and return
    const txt = await ok.r.text();
    let payload; try { payload = JSON.parse(txt); } catch { payload = { raw: txt }; }
    const candidates = [
      payload?.completion?.choices?.[0]?.message?.content,
      payload?.data?.completion?.choices?.[0]?.message?.content,
      payload?.choices?.[0]?.message?.content,
      payload?.choices?.[0]?.text,
      payload?.text, payload?.output
    ];
    const reply = candidates.find(v => typeof v === 'string' && v.trim()) || JSON.stringify(payload, null, 2);

    return res.status(200).json({
      ok:true, status:200, used_model:model,
      response: payload,
      choices:[{ message:{ content: reply } }]
    });

  } catch (err) {
    console.error('proxy_crash', err);
    return res.status(500).json({ error:'Upstream error (proxy exception)', detail:String(err) });
  }
}
