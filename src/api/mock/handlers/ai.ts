/**
 * AI assistant conversations. Owned by the settings area.
 * The real backend streams SSE; the mock answers deterministically from the demo DB and returns the whole
 * assistant message as JSON (`{ conversation, user_message, message }`) — the app animates the typing.
 */
import type { AIChart, AIConversation, AIConversationDetail, AIMessage, AIStatus, AIUIBlock } from '@/features/ai/types';

import { fail, istanbulDay, now, num, requirePerm, route, search, str, uuid, validation, type MockCtx } from '../core';
import { getDb } from '../db';

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

function answer(ctx: MockCtx, question: string, loc: Locale): AIUIBlock[] {
  const q = norm(question);
  const db = getDb();
  const m = moneyFmt(loc);
  const en = loc === 'en';

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
  return {
    available: remaining > 0,
    plan_enabled: true,
    ...(remaining > 0 ? {} : { reason: 'quota_exceeded' as const }),
    features: { chat: true, actions: false, charts: true, voice: false, todos: false },
    quota: {
      limit: QUOTA,
      used: tokensUsed,
      remaining,
      unlimited: false,
      period_start: new Date(month.getFullYear(), month.getMonth(), 1).toISOString(),
      period_end: new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString(),
    },
    provider: 'demo',
    model: 'otopoly-demo',
    tools: ['list_jobs', 'get_report_summary', 'get_finance_balances', 'search_customers', 'search_products', 'render_chart'],
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

route('POST', '/v1/tenant/ai/conversations/:uuid/messages', async (ctx) => {
  requirePerm(ctx, 'tenant.ai.use');
  const content = str(ctx.body.content).trim();
  if (!content) validation([{ field: 'content', message: 'required', code: 'required' }]);
  if (content.length > 4000) validation([{ field: 'content', message: 'too long', code: 'max_length' }]);
  if (tokensUsed >= QUOTA) fail(429, 'AI_QUOTA_EXCEEDED', 'Monthly assistant quota exceeded');
  const conv = findConv(ctx);
  if (conv.messages.length >= 200) fail(409, 'AI_CONVERSATION_LIMIT', 'Conversation is too long');
  // "Thinking" delay before the answer (the app shows the typing indicator meanwhile).
  await new Promise((r) => setTimeout(r, 450));
  const loc: Locale = str(ctx.body.locale) === 'en' ? 'en' : 'tr';
  const { user, assistant } = appendExchange(ctx, conv, content, loc);
  return { conversation: summary(conv), user_message: user, message: assistant };
});
