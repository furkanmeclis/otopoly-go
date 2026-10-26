/**
 * Web ⇄ app link mapping. Push payloads, in-app notifications and universal links all carry the
 * web addresses (`/t/{slug}/...`, `/q/{token}`, `/login/qr/{id}`); this module turns them into
 * Expo Router hrefs. Pure (no React Native imports) so the smoke tests can run it in Node.
 */

export const WEB_HOST = 'otopoly.app';
export const APP_SCHEME = 'otopoly';
/** Root route that resolves a web path once auth / organization context is known (src/app/link.tsx). */
export const LINK_ROUTE = '/link';

export type ResolvedLink =
  /** A tenant page: `href` is the app route, `slug` the organization it belongs to. */
  | { kind: 'tenant'; slug: string; href: string }
  /** Public customer quote page (`/q/{token}`). */
  | { kind: 'quote'; token: string; href: string }
  /** QR sign-in approval (`/login/qr/{id}`). */
  | { kind: 'qr'; token: string; href: string };

const SEG = '([^/]+)';

/** `[pattern on the path after /t/{slug}, app href builder]`, first match wins (static before :id). */
/** Minimal query parser (React Native's URLSearchParams polyfill is incomplete). */
function parseQuery(search: string) {
  const out = new Map<string, string>();
  for (const part of search.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = safeDecode((eq === -1 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq === -1 ? '' : safeDecode(part.slice(eq + 1).replace(/\+/g, ' '));
    if (!out.has(k)) out.set(k, v);
  }
  return out;
}

type Query = Map<string, string>;

const TENANT_RULES: [RegExp, (m: RegExpExecArray, q: Query) => string][] = [
  [/^\/?$/, () => '/'],
  [/^\/operations$/, () => '/operations'],
  [new RegExp(`^/operations/${SEG}$`), (m) => `/jobs/${m[1]}`],
  [/^\/jobs\/new$/, () => '/jobs/new'],
  [new RegExp(`^/jobs/${SEG}$`), (m) => `/jobs/${m[1]}`],
  [/^\/customers$/, () => '/customers'],
  [new RegExp(`^/customers/${SEG}$`), (m) => `/customers/${m[1]}`],
  [/^\/cari$/, () => '/cari'],
  [new RegExp(`^/cari/${SEG}$`), (m) => `/cari/${m[1]}`],
  [/^\/finance$/, () => '/finance'],
  [/^\/finance\/accounts$/, () => '/finance/accounts'],
  [new RegExp(`^/finance/accounts/${SEG}$`), (m) => `/finance/accounts/${m[1]}`],
  [/^\/finance\/categories$/, () => '/finance/categories'],
  [new RegExp(`^/finance/categories/${SEG}$`), (m) => `/finance/categories/${m[1]}`],
  [/^\/finance\/transactions$/, () => '/finance/transactions'],
  [/^\/finance\/transactions\/(income|expense)\/new$/, (m) => `/finance/transactions/new?type=${m[1]}`],
  [new RegExp(`^/finance/transactions/${SEG}$`), (m) => `/finance/transactions/${m[1]}`],
  [/^\/finance\/transfers\/new$/, () => '/finance/transfer'],
  [/^\/staff$/, () => '/staff'],
  [/^\/sales$/, () => '/sales'],
  [/^\/sales\/new$/, () => '/sales/new'],
  [new RegExp(`^/sales/${SEG}$`), (m) => `/sales/${m[1]}`],
  [/^\/suppliers$/, () => '/suppliers'],
  [new RegExp(`^/suppliers/${SEG}$`), (m) => `/suppliers/${m[1]}`],
  [/^\/purchases$/, () => '/purchases'],
  [/^\/purchases\/new$/, () => '/purchases/new'],
  [/^\/purchases\/reorder$/, (_m, q) => (q.get('tab') === 'drafts' ? '/purchases/reorder/drafts' : '/purchases/reorder')],
  [new RegExp(`^/purchases/${SEG}$`), (m) => `/purchases/${m[1]}`],
  [/^\/reports$/, () => '/reports'],
  [/^\/todos$/, (_m, q) => (q.get('todo') ? `/todos?todo=${encodeURIComponent(q.get('todo')!)}` : '/todos')],
  [/^\/leads$/, () => '/leads'],
  [/^\/leads\/new$/, () => '/leads/form'],
  [new RegExp(`^/leads/${SEG}$`), (m) => `/leads/${m[1]}`],
  [/^\/reviews$/, () => '/reviews'],
  [/^\/reviews\/settings$/, () => '/reviews/settings'],
  [new RegExp(`^/reviews/${SEG}$`), (m) => `/reviews/${m[1]}`],
  [/^\/quotes$/, () => '/quotes'],
  [/^\/quotes\/new$/, () => '/quotes/form'],
  [new RegExp(`^/quotes/${SEG}/edit$`), (m) => `/quotes/form?id=${m[1]}`],
  [new RegExp(`^/quotes/${SEG}$`), (m) => `/quotes/${m[1]}`],
  // Web keeps the open conversation in `?c=<uuid>`; the app has a screen per conversation.
  [/^\/assistant$/, (_m, q) => (q.get('c') ? `/assistant/${encodeURIComponent(q.get('c')!)}` : '/assistant')],
  [/^\/contracts$/, () => '/contracts'],
  [/^\/contracts\/templates$/, () => '/contracts/templates'],
  [new RegExp(`^/contracts/templates/${SEG}$`), (m) => `/contracts/templates/${m[1]}`],
  [new RegExp(`^/contracts/instances/${SEG}$`), (m) => `/contracts/instances/${m[1]}`],
  [/^\/catalog$/, () => '/catalog'],
  [/^\/catalog\/(products|services|categories)$/, (m) => `/catalog/${m[1]}`],
  [new RegExp(`^/catalog/(products|services|categories)/${SEG}$`), (m) => `/catalog/${m[1]}/${m[2]}`],
  [/^\/exports$/, () => '/exports'],
  [new RegExp(`^/exports/${SEG}$`), (m) => `/exports/${m[1]}`],
  [/^\/imports$/, () => '/imports'],
  [new RegExp(`^/imports/${SEG}$`), (m) => `/imports/${m[1]}`],
  [/^\/notifications$/, () => '/notifications'],
  [/^\/settings$/, () => '/menu'],
  [/^\/settings\/messaging$/, () => '/settings/messaging'],
  // No purchases in the app: the web billing page opens the read-only usage & limits screen.
  [/^\/settings\/billing(\/.*)?$/, () => '/settings/usage'],
  [/^\/settings\/letterhead$/, () => '/settings/letterhead'],
  [/^\/profile$/, () => '/profile'],
  [/^\/profile\/password$/, () => '/profile/password'],
  [/^\/profile\/preferences$/, () => '/profile/preferences'],
];

/**
 * Normalizes anything the OS, a push payload or a notification row may hand us into a web path
 * with query: `https://otopoly.app/t/x?y=1`, `otopoly://t/x`, `otopoly:///t/x`, `/t/x`, `t/x`.
 * Returns null for other hosts / unparsable input.
 */
export function toWebPath(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  let rest: string;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw);
  if (scheme) {
    const proto = scheme[1].toLowerCase();
    const afterScheme = scheme[2];
    if (proto === 'http' || proto === 'https') {
      const slash = afterScheme.indexOf('/');
      const host = (slash === -1 ? afterScheme : afterScheme.slice(0, slash)).split(/[?#]/)[0].toLowerCase();
      if (host !== WEB_HOST && host !== `www.${WEB_HOST}`) return null;
      rest = slash === -1 ? '/' : afterScheme.slice(slash);
    } else if (proto === APP_SCHEME || proto.startsWith('exp')) {
      // otopoly://t/slug → host is the first segment; otopoly:///t/slug → empty host.
      // Expo Go / dev clients use exp://host:port/--/t/slug.
      const devIdx = afterScheme.indexOf('/--/');
      rest = devIdx !== -1 ? afterScheme.slice(devIdx + 3) : proto === APP_SCHEME ? `/${afterScheme.replace(/^\/+/, '')}` : '/';
    } else {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    // mailto:, tel:, otopoly:t/x without slashes — nothing for the router.
    return null;
  } else {
    rest = raw.startsWith('/') ? raw : `/${raw}`;
  }
  rest = rest.split('#')[0];
  // Collapse duplicate slashes and drop a trailing slash (keep the root).
  const [p, ...q] = rest.split('?');
  const path = p.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  return q.length ? `${path}?${q.join('?')}` : path;
}

/** Maps a web path (or full URL) to an app destination; null when the app has nothing for it. */
export function resolveWebPath(input: string | null | undefined): ResolvedLink | null {
  const webPath = toWebPath(input);
  if (!webPath) return null;
  const [pathname, search = ''] = webPath.split('?');
  const query = parseQuery(search);
  const segs = pathname.split('/').filter(Boolean).map(safeDecode);

  if (segs[0] === 't' && segs[1]) {
    const slug = segs[1];
    const rest = `/${segs.slice(2).map(encodeURIComponent).join('/')}`;
    for (const [re, build] of TENANT_RULES) {
      const m = re.exec(rest === '/' ? '' : rest);
      if (m) return { kind: 'tenant', slug, href: build(m, query) };
    }
    // Unknown tenant page: still switch organization and land on the dashboard.
    return { kind: 'tenant', slug, href: '/' };
  }
  if (segs[0] === 'q' && segs[1] && segs.length === 2) {
    return { kind: 'quote', token: segs[1], href: `/q/${encodeURIComponent(segs[1])}` };
  }
  if (segs[0] === 'login' && segs[1] === 'qr' && segs[2] && segs.length === 3) {
    return { kind: 'qr', token: segs[2], href: `/login/qr/${encodeURIComponent(segs[2])}` };
  }
  return null;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Href of the resolver screen for a web path (used by +native-intent, push taps and the inbox). */
export function linkHref(webPath: string) {
  return `${LINK_ROUTE}?to=${encodeURIComponent(webPath)}`;
}

/**
 * `+native-intent` rewrite: tenant links go through the resolver (auth + organization switch),
 * `/q/*` and `/login/qr/*` open their own screens directly, everything else is left untouched.
 */
export function rewriteSystemPath(path: string): string {
  const resolved = resolveWebPath(path);
  if (!resolved) return path;
  if (resolved.kind === 'tenant') return linkHref(toWebPath(path)!);
  return resolved.href;
}

// ─── Notification actions (web `notification-action.ts`) ───────────────────

export type NotificationActionTarget =
  /** A web path to resolve through the link screen (may switch organization). */
  | { kind: 'web'; path: string }
  /** An app href inside the active organization. */
  | { kind: 'app'; href: string }
  /** Somewhere outside the app. */
  | { kind: 'external'; url: string };

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TENANT_API_ITEM = new RegExp(`^/v1/tenant/(exports|imports)/(${UUID_RE})(?:/.*)?$`, 'i');

function payloadSlug(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const slug = (payload as Record<string, unknown>).organization_slug;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : undefined;
}

/** Primary action of a notification `action_url`, or null when it has nothing to open in the app. */
export function notificationTarget(actionUrl: string | null | undefined, ctx: { activeSlug?: string | null; payload?: unknown } = {}): NotificationActionTarget | null {
  if (!actionUrl) return null;
  const url = actionUrl.trim();

  const api = TENANT_API_ITEM.exec(url);
  if (api) {
    // Export downloads open the export detail screen, which has the download button.
    const resource = api[1].toLowerCase();
    const slug = payloadSlug(ctx.payload);
    if (slug && slug !== ctx.activeSlug) return { kind: 'web', path: `/t/${slug}/${resource}/${api[2]}` };
    return { kind: 'app', href: `/${resource}/${api[2]}` };
  }
  if (url.startsWith('/v1/')) return null;

  if (/^https?:\/\//i.test(url)) {
    const web = toWebPath(url);
    if (web && resolveWebPath(web)) return { kind: 'web', path: web };
    return web ? null : { kind: 'external', url };
  }
  if (url.startsWith('/')) return resolveWebPath(url) ? { kind: 'web', path: toWebPath(url)! } : null;
  return null;
}

// ─── Inbox status helpers (web `features/notifications/constants.ts`) ──────

const UNREAD_STATUSES = ['queued', 'processing', 'sent', 'delivered'];

export function isUnreadNotification(n: { status: string; read_at?: string | null }) {
  if (n.read_at) return false;
  return UNREAD_STATUSES.includes(n.status);
}

export function canMarkNotificationRead(n: { channel: string; status: string; read_at?: string | null }) {
  return n.channel === 'inapp' && !n.read_at && n.status !== 'read';
}

/** `{ uuid, exp, sig }` from a `signed_action_url` (`/v1/notifications/{uuid}/action?exp=&sig=`). */
export function parseSignedActionUrl(href: string | null | undefined) {
  if (!href) return null;
  const [path, search = ''] = href.replace(/^https?:\/\/[^/]+/i, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'v1' || parts[1] !== 'notifications' || parts[3] !== 'action') return null;
  const q = parseQuery(search);
  const exp = Number(q.get('exp'));
  const sig = q.get('sig') ?? '';
  if (!Number.isFinite(exp) || !sig) return null;
  return { uuid: parts[2], exp, sig };
}
