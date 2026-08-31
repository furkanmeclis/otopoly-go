function normalizePath(path: string): string {
  if (!path) return "/";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
}

/**
 * Picks the most specific nav href that matches the current pathname.
 * Prevents parent routes (e.g. /finance) from staying active on child pages
 * (e.g. /finance/accounts) when siblings exist in the same group.
 */
export function resolveActiveNavHref(
  pathname: string,
  hrefs: string[],
): string | null {
  const current = normalizePath(pathname);
  let best: string | null = null;
  let bestLen = -1;

  for (const href of hrefs) {
    const target = normalizePath(href);
    if (current === target || current.startsWith(`${target}/`)) {
      if (target.length > bestLen) {
        best = href;
        bestLen = target.length;
      }
    }
  }

  return best;
}

export function isNavHrefActive(
  pathname: string,
  href: string,
  homeHref: string,
  peerHrefs?: string[],
): boolean {
  if (peerHrefs?.length) {
    return resolveActiveNavHref(pathname, peerHrefs) === href;
  }

  const current = normalizePath(pathname);
  const target = normalizePath(href);
  const home = normalizePath(homeHref);

  if (current === target) return true;
  if (target === home) return false;
  return current.startsWith(`${target}/`);
}

export function formatNavCount(value: number, max = 99): string {
  if (value > max) return `${max}+`;
  return String(value);
}
