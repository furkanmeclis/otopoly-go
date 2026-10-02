// Injected into every contract bundle (esbuild --inject). Records each request/response that goes through the
// API transport (JSON) or the mock multipart path, and writes them to $CONTRACT_OUT on exit.
const fs = require('node:fs');

const records = [];
let tag = '';

globalThis.__contractTag__ = (next) => {
  tag = next;
};

globalThis.__contractWrap__ = (transport, multipart = false) => async (req) => {
  const res = await transport(req);
  records.push({
    tag,
    method: req.method,
    path: req.path,
    query: req.query ?? null,
    body: req.body === undefined ? null : JSON.parse(JSON.stringify(req.body)),
    multipart,
    status: res.status,
    payload: res.payload ?? null,
  });
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
