/* AI SSE smoke test: the SSE reader, the live streaming transport (against a local Go-shaped SSE server:
 * token refresh, headers, incremental delivery, abort, non-streaming fallback) and the mock stream
 * (same events through the same reader).
 * Run: esbuild like `npm run test:mock`, with scripts/smoke/ai-stream.smoke.ts as the entry. */
import { isAborted, request } from '@/api/client';
import { isApiError } from '@/api/errors';
import { installMockTransport } from '@/api/mock';
import { session } from '@/api/session';
import { createSseParser, readSse, type SseEvent } from '@/api/sse';
import { env } from '@/config/env';
import { applyEvent, streamingMessage, type AIStreamEvent } from '@/features/ai/lib/stream';
import { aiService } from '@/features/ai/services/ai.service';

// Node built-ins without @types/node (the app tsconfig has none); esbuild keeps `require` for platform=node.
type Req = AsyncIterable<unknown> & { url?: string; headers: Record<string, string | undefined> };
type Res = { writeHead(s: number, h: Record<string, string>): void; write(c: string | Uint8Array): void; end(c?: string): void; on(e: 'close', f: () => void): void; writableEnded: boolean };
type Server = { listen(port: number, host: string, cb: () => void): void; address(): { port: number }; close(): void };
declare const require: (id: 'node:http') => { createServer(h: (req: Req, res: Res) => void): Server };
const http = require('node:http');

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UUID = '6f1c2a5e-0b8e-4d7a-9a51-2b7e0c1d3f40';
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function* bytes(parts: (string | Uint8Array)[]) {
  for (const p of parts) yield typeof p === 'string' ? new TextEncoder().encode(p) : p;
}

async function parserChecks() {
  console.log('SSE reader');
  const got: SseEvent[] = [];
  const p = createSseParser((e) => got.push(e));
  p.push(': stream open\n\nevent: text_delta\r\nda');
  p.push('ta: {"text":"a"}\r\n\r\nevent: x\ndata: {"a":\ndata: 1}\n\n: ping\n\n');
  p.push('event: title\ndata: {"title":"t"}');
  ok(got.length === 2 && got[0].event === 'text_delta' && (got[1].data as { a: number }).a === 1, 'split frames, CRLF, multi-line data, comments');
  p.end();
  ok(got.length === 3 && got[2].event === 'title', 'unterminated last frame flushed at end');

  // "Kasadaki tutar ışık" split inside the 2-byte "ı": the streaming decoder must keep it intact.
  const enc = new TextEncoder().encode(frame('text_delta', { text: 'ışık şoför' }));
  const out: SseEvent[] = [];
  await readSse(bytes([enc.slice(0, 27), enc.slice(27, 28), enc.slice(28)]), (e) => out.push(e));
  ok((out[0]?.data as { text: string })?.text === 'ışık şoför', 'multi-byte characters split across chunks');

  const bad: SseEvent[] = [];
  await readSse(bytes(['event: a\ndata: {not json}\n\nevent: b\ndata: {}\n\n']), (e) => bad.push(e));
  ok(bad.length === 1 && bad[0].event === 'b', 'frames with invalid JSON are skipped');

  let m = streamingMessage('tmp');
  const evs: AIStreamEvent[] = [
    { event: 'tool_start', data: { id: 't1', name: 'create_todo' } },
    { event: 'text_delta', data: { text: 'Mer' } },
    { event: 'text_delta', data: { text: 'haba' } },
    { event: 'plan', data: { block: { type: 'todo_list', id: 'plan', data: { title: 'P', items: [] } } } },
    { event: 'plan', data: { block: { type: 'todo_list', id: 'plan', data: { title: 'P2', items: [] } } } },
    { event: 'confirm', data: { block: { type: 'confirm', id: 'c1', status: 'pending', data: { tool_use_id: 't1' } as never } } },
    { event: 'message_done', data: { message_uuid: UUID, status: 'complete', stop_reason: 'tool_use', usage: {} } },
  ];
  ok(m.pending && applyEvent(m, evs[0]).pending === false, 'first event ends the "thinking" state');
  for (const e of evs) m = applyEvent(m, e);
  const plans = m.blocks.filter((b) => b.type === 'todo_list');
  ok(m.blocks.find((b) => b.type === 'text')?.text === 'Merhaba', 'text deltas join into one block');
  ok(plans.length === 1 && (plans[0].data as { title: string }).title === 'P2', 'plan replaced in place');
  ok(m.blocks.find((b) => b.type === 'tool')?.status === 'pending', 'confirm card marks its tool chip pending');
  ok(m.uuid === UUID && m.status === 'complete' && !m.streaming, 'message_done gives the server uuid and status');
}

/** A local server shaped like the Go AI handler (`handler.stream`). */
async function liveChecks() {
  console.log('live transport (local SSE server)');
  const seen: { path: string; auth?: string; accept?: string; lang?: string }[] = [];
  let release: (() => void) | null = null;
  let closedByClient = false;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, accept: req.headers.accept, lang: req.headers['accept-language'] as string });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-ID': 'req-1' });
      res.end(JSON.stringify(payload));
    };
    if (req.url === '/v1/auth/refresh') {
      return json(200, { success: true, data: { access_token: 'fresh', refresh_token: 'r2', token_type: 'Bearer', expires_in: 900, refresh_expires_at: new Date(Date.now() + 864e5).toISOString() }, meta: { request_id: 'x' } });
    }
    if (req.headers.authorization !== 'Bearer fresh') return json(401, { success: false, error: { code: 'UNAUTHENTICATED', message: 'expired' }, meta: { request_id: 'x' } });
    if (req.url?.endsWith('/quota/messages')) return json(403, { success: false, error: { code: 'AI_QUOTA_EXCEEDED', message: 'quota' }, meta: { request_id: 'x' } });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' });
    res.write(': stream open\n\n');
    if (req.url?.endsWith('/hang/messages')) {
      res.write(frame('message_start', { conversation_uuid: UUID, user_message_uuid: UUID }));
      res.on('close', () => (closedByClient = !res.writableEnded));
      await new Promise<void>((r) => (release = r));
      return res.end();
    }
    const { content } = JSON.parse(body || '{}') as { content?: string };
    res.write(frame('message_start', { conversation_uuid: UUID, user_message_uuid: UUID }));
    for (const word of ['Kasada ', 'şu an ', `${content ?? ''} var.`]) {
      await sleep(120);
      const b = new TextEncoder().encode(frame('text_delta', { text: word }));
      // Split inside the frame (and inside "ş" for the second word), then a keep-alive comment.
      res.write(b.subarray(0, 33));
      res.write(b.subarray(33));
      res.write(': ping\n\n');
    }
    res.write(frame('message_done', { message_uuid: UUID, status: 'complete', stop_reason: 'end_turn', usage: { input_tokens: 10 } }));
    res.end(frame('title', { conversation_uuid: UUID, title: 'Kasa' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => realFetch(String(url).replace(env.apiUrl, base), init)) as typeof fetch;

  await session.setTokens({ access_token: 'stale', refresh_token: 'r1', token_type: 'Bearer', expires_in: 900, refresh_expires_at: new Date(Date.now() + 864e5).toISOString() }, 'demo');
  const times: number[] = [];
  const t0 = Date.now();
  let m = streamingMessage('tmp');
  const names: string[] = [];
  await aiService.streamMessage('c1', '₺1.250', 'tr', {
    onEvent: (e) => {
      names.push(e.event);
      if (e.event === 'text_delta') times.push(Date.now() - t0);
      if (e.event !== 'message_start' && e.event !== 'title') m = applyEvent(m, e);
    },
  });
  const sse = seen.filter((s) => s.path === '/v1/tenant/ai/conversations/c1/messages');
  ok(sse.length === 2 && sse[0].auth === 'Bearer stale' && sse[1].auth === 'Bearer fresh' && seen.some((s) => s.path === '/v1/auth/refresh'), '401 → token refresh → stream retried');
  ok(sse[1].accept === 'text/event-stream' && Boolean(sse[1].lang), `Accept: text/event-stream, Accept-Language: ${sse[1].lang}`);
  ok(names.join(',') === 'message_start,text_delta,text_delta,text_delta,message_done,title', `events in order: ${names.join(',')}`);
  ok(m.blocks[0]?.text === 'Kasada şu an ₺1.250 var.', 'tokens assembled (UTF-8 across chunks)');
  ok(times.length === 3 && times[2] - times[0] >= 150, `tokens arrive incrementally (${times.join('ms, ')}ms)`);

  const quota = await aiService.streamMessage('quota', 'x', 'tr', { onEvent: () => undefined }).catch((e) => e);
  ok(isApiError(quota) && quota.code === 'AI_QUOTA_EXCEEDED' && quota.status === 403, 'pre-stream error → ApiError (JSON envelope)');

  const ctrl = new AbortController();
  const got: string[] = [];
  const pending = aiService.streamMessage('hang', 'x', 'tr', { signal: ctrl.signal, onEvent: (e) => got.push(e.event) }).catch((e) => e);
  for (let i = 0; i < 50 && !got.length; i++) await sleep(20);
  ctrl.abort();
  const aborted = await pending;
  for (let i = 0; i < 50 && !closedByClient; i++) await sleep(20);
  ok(got[0] === 'message_start' && isAborted(aborted), 'abort mid-stream → ABORTED');
  ok(closedByClient, 'abort closes the connection');
  (release as (() => void) | null)?.();

  // Runtime without a streaming body (RN fetch): the whole stream is parsed at the end.
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const res = await realFetch(String(url).replace(env.apiUrl, base), init);
    const text = res.ok ? await res.text() : null;
    return { ok: res.ok, status: res.status, headers: res.headers, body: null, text: async () => text ?? '', json: async () => JSON.parse(text ?? '{}') } as unknown as Response;
  }) as typeof fetch;
  const fallback = await aiService.sendMessage('c2', 'yedek', 'tr');
  ok(fallback.message.blocks[0]?.text === 'Kasada şu an yedek var.' && fallback.title === 'Kasa', 'no streaming body → same events once the body ends');

  globalThis.fetch = realFetch;
  server.close();
  await session.clear('test');
}

async function mockChecks() {
  console.log('mock stream (same reader)');
  await installMockTransport();
  const t = await request<any>('POST', '/v1/auth/login', { body: { email: 'demo@otopoly.com', password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  await session.setTokens(await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } }), me.organizations[0].slug);

  const conv = await aiService.createConversation();
  const turn = await aiService.sendMessage(conv.uuid, 'Bu ayın gelir grafiği', 'tr');
  const names = turn.events.map((e) => e.event);
  ok(names[0] === 'message_start' && names.includes('tool_start') && names.includes('tool_result') && names.includes('chart'), `events: ${[...new Set(names)].join(',')}`);
  ok(names.filter((n) => n === 'text_delta').length > 2, 'text arrives as several deltas');
  ok(names.indexOf('message_done') === names.length - 2 && names[names.length - 1] === 'title', 'message_done, then title for a new conversation');
  ok(turn.message.blocks.some((b) => b.type === 'chart') && Boolean(turn.userMessageUuid), 'chart block + user message uuid');
  const stored = await aiService.getConversation(conv.uuid);
  ok(stored.messages.at(-1)?.uuid === turn.message.uuid && JSON.stringify(stored.messages.at(-1)?.blocks) === JSON.stringify(turn.message.blocks), 'streamed message equals the stored one');

  const action = await aiService.sendMessage(conv.uuid, 'Yarın lastik siparişini hatırlat', 'tr');
  const anames = action.events.map((e) => e.event);
  ok(anames.includes('plan') && anames.includes('confirm') && !anames.includes('title'), 'action proposal streams plan + confirm (no title the second time)');
  const card = action.message.blocks.find((b) => b.type === 'confirm')!;
  const done = await aiService.confirmAction(card.id!, undefined, 'tr');
  const cnames = done.events.map((e) => e.event);
  ok(cnames[0] === 'action' && cnames[1] === 'message_start' && (done.events[1].data as { resumed?: boolean }).resumed === true, 'confirm: action, then resumed message_start');
  ok(done.block.status === 'confirmed' && done.message?.blocks.some((b) => b.type === 'text'), 'confirmed card + streamed follow-up');

  const ctrl = new AbortController();
  const p = aiService.streamMessage(conv.uuid, 'Kasalarda ne kadar para var?', 'tr', { signal: ctrl.signal, onEvent: () => ctrl.abort() }).catch((e) => e);
  ok(isAborted(await p), 'mock stream honours abort');
  const empty = await aiService.sendMessage(conv.uuid, '   ', 'tr').catch((e) => e);
  ok(isApiError(empty) && empty.code === 'VALIDATION_ERROR', 'validation error before the stream opens');
}

(async () => {
  await parserChecks();
  await liveChecks();
  await mockChecks();
  console.log(failures ? `\n${failures} FAILED` : '\nall AI stream checks passed');
  process.exit(failures ? 1 : 0);
})();
