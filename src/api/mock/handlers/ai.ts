/**
 * AI assistant conversations. Owned by the settings area.
 * The mock answers deterministically from the demo DB and, like the Go API, streams the answer as
 * server-sent events (`message_start`, `tool_start`/`tool_result`, `chart`, `plan`, `confirm`,
 * `text_delta`…, `message_done`, `title`), so the app's SSE reader is the same in mock and live mode.
 *
 * Write actions (`actions` / `todos` features): a reminder / todo request ("yarın lastik siparişini
 * hatırlat") answers with a plan checklist, a pending `create_todo` tool chip and a confirm card.
 * `POST /v1/tenant/ai/actions/:uuid/confirm` creates the todo (edits applied) and streams `action`
 * then the resumed follow-up message; `/cancel` returns `{ block }` as JSON. Cards expire after
 * 15 minutes like the API.
 */
import type { AIChart, AIConfirmCard, AIConversation, AIConversationDetail, AIMessage, AIPlan, AIStatus, AIUIBlock } from '@/features/ai/types';

import { fail, istanbulDay, MockSse, now, num, requirePerm, route, search, sse, str, uuid, validation, type MockCtx } from '../core';
import { getDb } from '../db';
import { planFeatureEnabled } from './billing';
import { createTodo } from './crm';

type Conv = AIConversationDetail;
const conversations = new Map<string, Conv[]>(); // `${org}|${user}`
let tokensUsed = 164250;
const QUOTA = 200000;

function listFor(ctx: MockCtx): Conv[] {
  const key = `${ctx.orgUuid}|${ctx.user?.uuid}`;
  let list = conversations.get(key);
  if (!list) {
    list = [];
    conversations.set(key, list);
    // One earlier chat so the history is not empty in the demo.
    const created = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const conv: Conv = { uuid: uuid(), title: '', message_count: 0, created_at: created, updated_at: created, messages: [] };
    list.push(conv);
    const question = ctx.user?.locale === 'en' ? 'How much money is in the cash accounts?' : 'Kasalarda ne kadar para var?';
    appendExchange(ctx, conv, question, ctx.user?.locale === 'en' ? 'en' : 'tr', created);
  }
  return list;
}

const summary = ({ messages: _m, ...c }: Conv): AIConversation => c;

function findConv(ctx: MockCtx) {
  return listFor(ctx).find((c) => c.uuid === ctx.params.uuid) ?? fail(404, 'NOT_FOUND', 'Conversation not found');
}

// ─── Deterministic answers from the demo data ───────────────────────────────

type Locale = 'tr' | 'en';
const moneyFmt = (loc: Locale) => new Intl.NumberFormat(loc === 'en' ? 'en-US' : 'tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
const tool = (name: string, summary_key: string, summary_params: Record<string, string | number>): AIUIBlock => ({
  type: 'tool',
  id: `toolu_${uuid().slice(0, 8)}`,
  name,
  status: 'done',
  summary_key,
  summary_params,
});
const text = (t: string): AIUIBlock => ({ type: 'text', text: t });

function norm(s: string) {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}
const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

function todaysJobs(ctx: MockCtx) {
  const today = istanbulDay();
  return getDb().jobs.filter((j) => j._org === ctx.orgUuid && istanbulDay(j.started_at) === today && j.status !== 'voided' && j.status !== 'cancelled');
}

// ─── Proposed actions (confirm cards + plan) ────────────────────────────────

const ACTION_TTL_MS = 15 * 60 * 1000;
type PendingAction = { conv: Conv; orgUuid: string | null; userUuid: string; loc: Locale };
const actionsById = new Map<string, PendingAction>();

const PLAN_TEXT = {
  tr: { title: 'Görev ekleme', understand: 'İsteği anla', prepare: 'Görevi hazırla', save: 'Onayınızla kaydet' },
  en: { title: 'Adding a todo', understand: 'Understand the request', prepare: 'Prepare the todo', save: 'Save after your approval' },
};

function planBlock(loc: Locale, last: AIPlan['items'][number]['status']): AIUIBlock {
  const p = PLAN_TEXT[loc];
  const data: AIPlan = {
    title: p.title,
    items: [
      { text: p.understand, status: 'done' },
      { text: p.prepare, status: 'done' },
      { text: p.save, status: last },
    ],
  };
  return { type: 'todo_list', id: 'plan', data };
}

const FILLER = /(^|\s)(yarın|yarin|bugün|bugun|tomorrow|today|bana|lütfen|lutfen|please|hatırlat|hatirlat|remind me( to)?|remind|görev ekle|gorev ekle|yapılacak ekle|add a todo( to)?|add todo)(?=\s|$|[.,!?])/giu;

/** "yarın lastik siparişini hatırlat" → "Lastik siparişini" (the question without filler words). */
export function todoTitle(question: string) {
  const cleaned = question.replace(FILLER, ' ').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  const base = cleaned || question.trim();
  const title = base.charAt(0).toLocaleUpperCase('tr-TR') + base.slice(1);
  return title.length > 80 ? `${title.slice(0, 79).trimEnd()}…` : title;
}

function proposeTodo(question: string, loc: Locale): AIUIBlock[] {
  const en = loc === 'en';
  const q = norm(question);
  const title = todoTitle(question);
  const due = has(q, 'bugun', 'today') ? istanbulDay() : istanbulDay(new Date(Date.now() + 86400000));
  const toolUseId = `toolu_${uuid().slice(0, 8)}`;
  const card: AIConfirmCard = {
    preview: {
      action: 'create_todo',
      title,
      fields: [
        { key: 'title', value: title },
        { key: 'due_date', value: due },
        { key: 'due_time', value: '10:00' },
        { key: 'assignee', value_key: 'ai.confirm.values.unassigned' },
      ],
      edit: [
        { key: 'title', type: 'text', value: title, required: true },
        { key: 'due_date', type: 'date', value: due },
        { key: 'due_time', type: 'time', value: '10:00' },
      ],
    },
    tool_use_id: toolUseId,
    expires_at: new Date(Date.now() + ACTION_TTL_MS).toISOString(),
  };
  return [
    planBlock(loc, 'in_progress'),
    { type: 'tool', id: toolUseId, name: 'create_todo', status: 'pending' },
    { type: 'confirm', id: uuid(), status: 'pending', data: card },
    text(en ? 'I prepared this todo. Nothing is saved until you confirm; you can edit it first.' : 'Bu görevi hazırladım. Siz onaylamadan kaydedilmez; isterseniz önce düzenleyebilirsiniz.'),
  ];
}

function answer(ctx: MockCtx, question: string, loc: Locale): AIUIBlock[] {
  const q = norm(question);
  const db = getDb();
  const m = moneyFmt(loc);
  const en = loc === 'en';

  if (has(q, 'hatirlat', 'gorev', 'yapilacak', 'remind', 'todo', 'task')) return proposeTodo(question, loc);

  if (has(q, 'teslim', 'deliver')) {
    const today = istanbulDay();
    const delivered = db.jobs.filter((j) => j._org === ctx.orgUuid && j.delivered_at && istanbulDay(j.delivered_at) === today);
    const list = delivered.slice(0, 8).map((j) => `- **${j.plate}** · ${j.customer_name} · ${m.format(num(j.total_amount))}`);
    return [
      tool('list_jobs', 'ai.tool_summary.jobs_found', { count: delivered.length }),
      text(
        delivered.length
          ? `${en ? `**${delivered.length}** vehicles were delivered today:` : `Bugün **${delivered.length}** araç teslim edildi:`}\n\n${list.join('\n')}${delivered.length > 8 ? `\n\n${en ? `…and ${delivered.length - 8} more.` : `…ve ${delivered.length - 8} araç daha.`}` : ''}`
          : en
            ? 'No vehicles have been delivered yet today.'
            : 'Bugün henüz teslim edilen araç yok.',
      ),
    ];
  }

  if (has(q, 'grafik', 'chart', 'gelir', 'revenue', 'ciro')) {
    const month = istanbulDay().slice(0, 7);
    const byDay = new Map<string, number>();
    for (const t of db.transactions)
      if (t.type === 'income' && t.status === 'posted' && t.transaction_date.startsWith(month)) byDay.set(t.transaction_date, (byDay.get(t.transaction_date) ?? 0) + num(t.amount));
    const rows = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, income]) => ({ day: day.slice(8, 10), income: Math.round(income * 100) / 100 }));
    const total = rows.reduce((s, r) => s + r.income, 0);
    const best = rows.reduce<{ day: string; income: number } | null>((b, r) => (!b || r.income > b.income ? r : b), null);
    const title = en ? 'Income this month' : 'Bu ayın geliri';
    const chart: AIChart = { type: 'bar', title, x_key: 'day', series: [{ key: 'income', label: en ? 'Income' : 'Gelir' }], rows, value_format: 'currency', currency: 'TRY' };
    return [
      tool('get_report_summary', 'ai.tool_summary.report_ready', { from: `${month}-01`, to: istanbulDay() }),
      tool('render_chart', 'ai.tool_summary.chart_rendered', { title }),
      { type: 'chart', id: uuid(), chart },
      text(
        en
          ? `Total income this month is **${m.format(total)}** over ${rows.length} days${best ? `; the best day was the ${best.day}th with ${m.format(best.income)}` : ''}.`
          : `Bu ay ${rows.length} günde toplam **${m.format(total)}** gelir oluştu${best ? `; en iyi gün ayın ${best.day}'i (${m.format(best.income)})` : ''}.`,
      ),
    ];
  }

  if (has(q, 'cari', 'borc', 'alacak', 'receivable', 'debt', 'owe')) {
    const top = db.cariAccounts
      .filter((a) => num(a.balance) > 0)
      .sort((a, b) => num(b.balance) - num(a.balance))
      .slice(0, 5);
    const total = db.cariAccounts.reduce((s, a) => s + Math.max(0, num(a.balance)), 0);
    return [
      tool('search_customers', 'ai.tool_summary.customers_found', { count: top.length }),
      text(
        top.length
          ? `${en ? 'Customers with the highest open balance:' : 'En yüksek cari borcu olan müşteriler:'}\n\n${top.map((a, i) => `${i + 1}. **${a.customer_name}** — ${m.format(num(a.balance))}`).join('\n')}\n\n${en ? `Total receivables: **${m.format(total)}**.` : `Toplam alacak: **${m.format(total)}**.`}`
          : en
            ? 'No customer has an open balance right now.'
            : 'Şu anda borcu olan müşteri yok.',
      ),
    ];
  }

  if (has(q, 'kasa', 'banka', 'bakiye', 'cash', 'balance', 'para')) {
    const accounts = db.financeAccounts.filter((a) => a.is_active);
    const total = accounts.reduce((s, a) => s + num(a.current_balance), 0);
    return [
      tool('get_finance_balances', 'ai.tool_summary.accounts_found', { count: accounts.length }),
      text(
        `${accounts.map((a) => `- **${a.name}** (${a.type === 'cash' ? (en ? 'cash' : 'kasa') : en ? 'bank' : 'banka'}): ${m.format(num(a.current_balance))}`).join('\n')}\n\n${en ? `Total: **${m.format(total)}**.` : `Toplam: **${m.format(total)}**.`}`,
      ),
    ];
  }

  if (has(q, 'stok', 'stock', 'urun', 'product')) {
    const low = db.products.filter((p) => p.track_stock && (p.stock_status === 'low_stock' || p.stock_status === 'out_of_stock'));
    return [
      tool('search_products', 'ai.tool_summary.products_found', { count: low.length }),
      text(
        low.length
          ? `${en ? 'These products are running low:' : 'Stoğu azalan ürünler:'}\n\n${low
              .slice(0, 10)
              .map((p) => `- **${p.name}** — ${num(p.stock_quantity)} ${en ? 'left' : 'adet kaldı'} (${en ? 'alert at' : 'uyarı eşiği'} ${num(p.min_stock_alert)})`)
              .join('\n')}`
          : en
            ? 'All tracked products are above their stock alert level.'
            : 'Takip edilen tüm ürünler uyarı eşiğinin üzerinde.',
      ),
    ];
  }

  // Default: today's operations snapshot.
  const jobs = todaysJobs(ctx);
  const revenue = jobs.reduce((s, j) => s + num(j.total_amount), 0);
  const count = (status: string) => jobs.filter((j) => j.status === status).length;
  const open = count('in_progress');
  const ready = count('ready');
  const unpaid = jobs.filter((j) => j.payment_status !== 'paid').length;
  const intro = has(q, 'bugun', 'today', 'is ', 'job', 'arac', 'vehicle', 'ozet', 'summary')
    ? ''
    : en
      ? "I'm a demo assistant, so I answer from your live demo data. Here is today's snapshot:\n\n"
      : 'Demo asistanıyım; yanıtları işletmenizin demo verilerinden üretiyorum. Bugünün özeti:\n\n';
  return [
    tool('list_jobs', 'ai.tool_summary.jobs_found', { count: jobs.length }),
    text(
      `${intro}${
        en
          ? `- **${jobs.length}** jobs today, total **${m.format(revenue)}**\n- ${open} in progress, ${ready} ready for pickup\n- ${unpaid} not paid yet`
          : `- Bugün **${jobs.length}** iş emri, toplam **${m.format(revenue)}**\n- ${open} işlemde, ${ready} teslime hazır\n- ${unpaid} iş henüz ödenmedi`
      }\n\n${en ? 'You can also ask about deliveries, income, receivables, cash or low stock.' : 'Teslimatlar, gelir, cari alacaklar, kasa veya stok hakkında da sorabilirsiniz.'}`,
    ),
  ];
}

function appendExchange(ctx: MockCtx, conv: Conv, content: string, loc: Locale, at = now()) {
  const user: AIMessage = { uuid: uuid(), role: 'user', status: 'complete', blocks: [{ type: 'text', text: content }], created_at: at };
  const assistant: AIMessage = { uuid: uuid(), role: 'assistant', status: 'complete', blocks: answer(ctx, content, loc), created_at: at };
  for (const b of assistant.blocks) if (b.type === 'confirm' && b.id) actionsById.set(b.id, { conv, orgUuid: ctx.orgUuid, userUuid: ctx.user?.uuid ?? '', loc });
  conv.messages.push(user, assistant);
  conv.message_count = conv.messages.length;
  conv.last_message_at = at;
  conv.updated_at = at;
  if (!conv.title) conv.title = content.length > 48 ? `${content.slice(0, 47).trimEnd()}…` : content;
  tokensUsed += 350 + content.length * 3;
  return { user, assistant };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/ai/status', (ctx): AIStatus => {
  requirePerm(ctx, 'tenant.ai.use');
  const remaining = Math.max(0, QUOTA - tokensUsed);
  const month = new Date();
  const planEnabled = planFeatureEnabled('ai.enabled');
  return {
    available: planEnabled && remaining > 0,
    plan_enabled: planEnabled,
    ...(!planEnabled ? { reason: 'plan_disabled' as const } : remaining > 0 ? {} : { reason: 'quota_exceeded' as const }),
    features: { chat: true, actions: true, charts: true, voice: false, todos: true },
    quota: {
      limit: QUOTA,
      used: tokensUsed,
      remaining,
      unlimited: false,
      period_start: new Date(month.getFullYear(), month.getMonth(), 1).toISOString(),
      period_end: new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString(),
    },
    // What the live API reports for the default setup; the consent screen names this provider.
    provider: 'anthropic',
    model: 'otopoly-demo',
    tools: ['list_jobs', 'get_report_summary', 'get_finance_balances', 'search_customers', 'search_products', 'render_chart', 'create_todo', 'update_plan'],
  };
});

route('GET', '/v1/tenant/ai/conversations', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const items = search(listFor(ctx), ctx.query.q, ['title'])
    .map(summary)
    .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
  const limit = Math.min(Math.max(num(ctx.query.limit) || 50, 1), 100);
  return { items: items.slice(0, limit), total: items.length, limit, offset: 0 };
});

route('POST', '/v1/tenant/ai/conversations', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const title = str(ctx.body.title).trim().slice(0, 120);
  const conv: Conv = { uuid: uuid(), title, message_count: 0, created_at: now(), updated_at: now(), messages: [] };
  listFor(ctx).push(conv);
  return summary(conv);
});

route('GET', '/v1/tenant/ai/conversations/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  return findConv(ctx);
});

route('PATCH', '/v1/tenant/ai/conversations/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const title = str(ctx.body.title).trim();
  if (!title) validation([{ field: 'title', message: 'required', code: 'required' }]);
  const conv = findConv(ctx);
  conv.title = title.slice(0, 120);
  conv.updated_at = now();
  return summary(conv);
});

route('DELETE', '/v1/tenant/ai/conversations/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const conv = findConv(ctx);
  const list = listFor(ctx);
  list.splice(list.indexOf(conv), 1);
  return { deleted: true };
});

// ─── SSE ────────────────────────────────────────────────────────────────────

/** Splits text into small deltas (a few words each) like a model's token stream. */
function deltas(t: string) {
  return t.match(/\S+\s*|\s+/g)?.reduce<string[]>((out, word, i) => {
    if (i % 3 === 0) out.push(word);
    else out[out.length - 1] += word;
    return out;
  }, []) ?? [];
}

/**
 * The events the Go agent loop emits for a finished assistant message (`usecase/chat.go`):
 * tool_start → tool_result per tool, chart, plan, confirm, text_delta chunks, message_done.
 */
function messageEvents(message: AIMessage, content: string): MockSse['events'] {
  const events: MockSse['events'] = [];
  for (const b of message.blocks) {
    if (b.type === 'text') for (const d of deltas(b.text ?? '')) events.push({ event: 'text_delta', data: { text: d } });
    else if (b.type === 'tool') {
      events.push({ event: 'tool_start', data: { id: b.id, name: b.name } });
      if (b.status === 'done' || b.status === 'error')
        events.push({ event: 'tool_result', data: { id: b.id, name: b.name, ok: b.status === 'done', summary_key: b.summary_key ?? '', summary_params: b.summary_params ?? {} } });
    } else if (b.type === 'chart') events.push({ event: 'chart', data: { id: b.id, chart: b.chart } });
    else if (b.type === 'todo_list') events.push({ event: 'plan', data: { block: b } });
    else if (b.type === 'confirm') events.push({ event: 'confirm', data: { block: b } });
    else if (b.type === 'error') events.push({ event: 'error', data: { code: b.code, message: b.message ?? '' } });
  }
  const paused = message.blocks.some((b) => b.type === 'confirm' && b.status === 'pending');
  events.push({
    event: 'message_done',
    data: {
      message_uuid: message.uuid,
      status: message.status,
      stop_reason: paused ? 'tool_use' : 'end_turn',
      usage: { input_tokens: 1200 + content.length * 3, output_tokens: 150 + Math.round(JSON.stringify(message.blocks).length / 4) },
    },
  });
  return events;
}

route('POST', '/v1/tenant/ai/conversations/:uuid/messages', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  // Checked before the stream opens (regular JSON errors), like `PrepareMessage`.
  const content = str(ctx.body.content).trim();
  if (!content) validation([{ field: 'content', message: 'content is required', code: 'required' }]);
  if (content.length > 8000) validation([{ field: 'content', message: 'content is too long (max 8000 characters)', code: 'max_length' }]);
  const conv = findConv(ctx);
  if (tokensUsed >= QUOTA) fail(403, 'AI_QUOTA_EXCEEDED', 'Monthly assistant quota exceeded');
  if (conv.messages.length >= 400) fail(409, 'AI_CONVERSATION_LIMIT', 'this conversation is too long; start a new one');
  const loc: Locale = str(ctx.body.locale) === 'en' ? 'en' : str(ctx.body.locale) === 'tr' ? 'tr' : ctx.user?.locale === 'en' ? 'en' : 'tr';
  const untitled = !conv.title;
  const { user, assistant } = appendExchange(ctx, conv, content, loc);
  const events: MockSse['events'] = [
    { event: 'message_start', data: { conversation_uuid: conv.uuid, user_message_uuid: user.uuid } },
    ...messageEvents(assistant, content),
  ];
  if (untitled) events.push({ event: 'title', data: { conversation_uuid: conv.uuid, title: conv.title } });
  // "Thinking" before the first token (the app shows the waiting indicator meanwhile).
  return sse(events, 450);
});

// ─── Action confirm / cancel ────────────────────────────────────────────────

function findAction(ctx: MockCtx) {
  const entry = actionsById.get(ctx.params.uuid);
  // Another user's or organization's action looks like a missing one.
  if (!entry || entry.orgUuid !== ctx.orgUuid || entry.userUuid !== ctx.user?.uuid) fail(404, 'NOT_FOUND', 'Action not found');
  const message = entry!.conv.messages.find((msg) => msg.blocks.some((b) => b.type === 'confirm' && b.id === ctx.params.uuid));
  const block = message?.blocks.find((b) => b.type === 'confirm' && b.id === ctx.params.uuid);
  if (!message || !block) fail(404, 'NOT_FOUND', 'Action not found');
  return { entry: entry!, message: message!, block: block! };
}

/** Moves the card, its tool chip and the message's plan to their resolved state (in place). */
function resolve(message: AIMessage, block: AIUIBlock, status: string, loc: Locale, result?: AIConfirmCard['result']) {
  const card = block.data as AIConfirmCard;
  const next: AIUIBlock = { ...block, status, data: { ...card, ...(result ? { result } : {}) } };
  const toolStatus = status === 'confirmed' ? 'done' : status === 'failed' ? 'error' : 'cancelled';
  message.blocks = message.blocks.map((b) => {
    if (b.type === 'confirm' && b.id === block.id) return next;
    if (b.type === 'tool' && b.id === card.tool_use_id) return { ...b, status: toolStatus };
    if (b.type === 'todo_list') return planBlock(loc, status === 'confirmed' ? 'done' : 'skipped');
    return b;
  });
  return next;
}

function assertPending(message: AIMessage, block: AIUIBlock, loc: Locale) {
  if (block.status !== 'pending') fail(409, 'AI_ACTION_RESOLVED', 'This action was already confirmed or cancelled');
  const card = block.data as AIConfirmCard;
  if (new Date(card.expires_at).getTime() < Date.now()) {
    resolve(message, block, 'expired', loc);
    fail(409, 'AI_ACTION_EXPIRED', 'The confirmation window has expired');
  }
}

route('POST', '/v1/tenant/ai/actions/:uuid/confirm', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const { entry, message, block } = findAction(ctx);
  const loc: Locale = str(ctx.body.locale) === 'en' ? 'en' : str(ctx.body.locale) === 'tr' ? 'tr' : entry.loc;
  assertPending(message, block, loc);
  if (!ctx.permissions.has('tenant.todos.write')) fail(403, 'AI_ACTION_FORBIDDEN', 'You are not allowed to run this action');
  const card = block.data as AIConfirmCard;
  const edits = (ctx.body.edits ?? {}) as Record<string, unknown>;
  const valueOf = (k: string) => (edits[k] !== undefined ? str(edits[k]).trim() : (card.preview.edit?.find((f) => f.key === k)?.value ?? ''));
  const title = valueOf('title');
  if (!title) validation([{ field: 'title', message: 'required', code: 'required' }]);
  const dueDate = valueOf('due_date');
  const dueTime = dueDate ? valueOf('due_time') : '';
  const todo = createTodo(ctx, { title, due_date: dueDate || null, due_time: dueTime || null, via_ai: true });
  const fields = card.preview.fields.map((f) => (f.key === 'title' ? { ...f, value: title } : f.key === 'due_date' ? { ...f, value: dueDate } : f.key === 'due_time' ? { ...f, value: dueTime } : f));
  block.data = { ...card, preview: { ...card.preview, title, fields } };
  const next = resolve(message, block, 'confirmed', loc, {
    ok: true,
    summary_key: 'ai.tool_summary.todo_created',
    summary_params: { title },
    link: { kind: 'todo', uuid: todo.uuid },
  });
  const at = now();
  const follow: AIMessage = {
    uuid: uuid(),
    role: 'assistant',
    status: 'complete',
    blocks: [text(loc === 'en' ? `Done, **${title}** is on your todo list.` : `Tamam, **${title}** görevini listenize ekledim.`)],
    created_at: at,
  };
  entry.conv.messages.push(follow);
  entry.conv.message_count = entry.conv.messages.length;
  entry.conv.last_message_at = at;
  entry.conv.updated_at = at;
  // `RunConfirm`: the action result, then the model's continuation as a resumed message.
  return sse(
    [
      { event: 'action', data: { action_uuid: block.id, status: next.status, tool_use_id: card.tool_use_id, block: next } },
      { event: 'message_start', data: { conversation_uuid: entry.conv.uuid, resumed: true, action_uuid: block.id } },
      ...messageEvents(follow, title),
    ],
    250,
  );
});

route('POST', '/v1/tenant/ai/actions/:uuid/cancel', (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const { entry, message, block } = findAction(ctx);
  assertPending(message, block, entry.loc);
  return { block: resolve(message, block, 'cancelled', entry.loc) };
});
