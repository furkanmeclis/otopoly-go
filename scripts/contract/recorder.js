// Injected into every contract bundle (esbuild --inject). Records each request/response that goes through the
// API transport (JSON) or the mock multipart path, and writes them to $CONTRACT_OUT on exit.
const fs = require('node:fs');

const records = [];
let tag = '';

globalThis.__contractTag__ = (next) => {
  tag = next;
};

/** Frames a raw SSE byte stream (same rules as src/api/sse.ts) into `{ event, data, raw }` records. */
function sseCollector(out) {
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (frame) => {
    let event = 'message';
    const data = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) return;
    let parsed;
    try {
      parsed = JSON.parse(data.join('\n'));
    } catch {
      parsed = undefined;
    }
    out.push({ event, data: parsed, raw: parsed === undefined ? data.join('\n') : undefined });
  };
  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let m = /\r?\n\r?\n/.exec(buffer); m; m = /\r?\n\r?\n/.exec(buffer)) {
        flush(buffer.slice(0, m.index));
        buffer = buffer.slice(m.index + m[0].length);
      }
    },
    end() {
      buffer += decoder.decode();
      if (buffer.trim()) flush(buffer);
      buffer = '';
    },
  };
}

globalThis.__contractWrap__ = (transport, multipart = false) => async (req) => {
  const res = await transport(req);
  const record = {
    tag,
    method: req.method,
    path: req.path,
    query: req.query ?? null,
    body: req.body === undefined ? null : JSON.parse(JSON.stringify(req.body)),
    multipart,
    accept: req.headers?.Accept ?? null,
    status: res.status,
    payload: res.payload ?? null,
  };
  records.push(record);
  if (res.stream) {
    // Tee the event stream: the app reads it as usual, the recorder keeps every event for validation.
    record.contentType = 'text/event-stream';
    record.events = [];
    record.streamComplete = false;
    const collector = sseCollector(record.events);
    const source = res.stream;
    return {
      ...res,
      stream: (async function* tee() {
        try {
          for await (const chunk of source) {
            collector.push(chunk);
            yield chunk;
          }
          collector.end();
          record.streamComplete = true;
        } finally {
          // Stopped by the app (stop button / unmount): only the events received are checked.
          record.aborted = Boolean(req.signal?.aborted);
        }
      })(),
    };
  }
  return res;
};

process.on('exit', () => {
  if (!process.env.CONTRACT_OUT) return;
  let routes = [];
  try {
    routes = globalThis.__contractRoutes__ ? globalThis.__contractRoutes__() : [];
  } catch {
    routes = [];
  }
  fs.writeFileSync(process.env.CONTRACT_OUT, JSON.stringify({ records, routes }));
});
