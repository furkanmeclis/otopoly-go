import type { DiscountType, QuoteStatus } from "@/features/quotes/types";

export function quoteStatusTone(status: QuoteStatus) {
  switch (status) {
    case "draft":
      return "default" as const;
    case "sent":
    case "viewed":
      return "warning" as const;
    case "accepted":
      return "success" as const;
    case "rejected":
    case "expired":
    case "cancelled":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

/** Stepper order for the happy path. */
export const QUOTE_STEPS: QuoteStatus[] = [
  "draft",
  "sent",
  "viewed",
  "accepted",
];

/* ---- live totals preview (server recomputes; this only mirrors it) ---- */

type Cents = bigint;

function toCents(raw: string | undefined | null): Cents {
  const s = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!s || !/^\d*(\.\d*)?$/.test(s)) return BigInt(0);
  const [i, f = ""] = s.split(".");
  // Round half-up at 2 decimals.
  const frac3 = (f + "000").slice(0, 3);
  let cents = BigInt(i || "0") * BigInt(100) + BigInt(frac3.slice(0, 2));
  if (Number(frac3[2]) >= 5) cents += BigInt(1);
  return cents;
}

/** Parse a decimal to a scaled integer with 3 decimals (quantities). */
function toMilli(raw: string | undefined | null): bigint {
  const s = String(raw ?? "")
    .trim()
    .replace(",", ".");
  if (!s || !/^\d*(\.\d*)?$/.test(s)) return BigInt(0);
  const [i, f = ""] = s.split(".");
  return BigInt(i || "0") * BigInt(1000) + BigInt((f + "000").slice(0, 3));
}

function divRound(n: bigint, d: bigint): bigint {
  if (d === BigInt(0)) return BigInt(0);
  const q = n / d;
  const r = n % d;
  return r * BigInt(2) >= d ? q + BigInt(1) : q;
}

export type DraftLine = {
  quantity: string;
  unit_price: string;
  discount_type: DiscountType;
  discount_value: string;
  vat_rate: string;
};

export type DraftTotals = {
  lines: { total: string; net: string }[];
  subtotal: string;
  discount: string;
  vat: string;
  grand: string;
};

export function centsToString(c: bigint): string {
  const neg = c < BigInt(0);
  const a = neg ? -c : c;
  const s = `${a / BigInt(100)}.${(a % BigInt(100)).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

function discountCents(
  base: bigint,
  type: DiscountType,
  value: string,
): bigint {
  if (type === "percent") {
    const pctMilli = toMilli(value); // percent × 1000
    const d = divRound(base * pctMilli, BigInt(100_000));
    return d > base ? base : d;
  }
  if (type === "amount") {
    const d = toCents(value);
    return d > base ? base : d;
  }
  return BigInt(0);
}

/** Mirrors backend ComputeTotals (half-up, pro-rata quote discount). */
export function computeDraftTotals(
  lines: DraftLine[],
  quoteDiscountType: DiscountType,
  quoteDiscountValue: string,
  pricesIncludeVat: boolean,
): DraftTotals {
  const work = lines.map((l) => {
    const sub = divRound(
      toMilli(l.quantity) * toCents(l.unit_price),
      BigInt(1000),
    );
    const disc = discountCents(sub, l.discount_type, l.discount_value);
    return {
      sub,
      disc,
      after: sub - disc,
      share: BigInt(0),
      rate: toMilli(l.vat_rate),
    };
  });
  const sumSub = work.reduce((a, w) => a + w.sub, BigInt(0));
  const sumDisc = work.reduce((a, w) => a + w.disc, BigInt(0));
  const sumAfter = work.reduce((a, w) => a + w.after, BigInt(0));
  const qd = discountCents(sumAfter, quoteDiscountType, quoteDiscountValue);
  if (qd > BigInt(0) && sumAfter > BigInt(0)) {
    let last = -1;
    work.forEach((w, i) => {
      if (w.after > BigInt(0)) last = i;
    });
    let allocated = BigInt(0);
    for (let i = 0; i < work.length; i++) {
      const w = work[i]!;
      if (w.after === BigInt(0)) continue;
      if (i === last) {
        w.share = qd - allocated;
        break;
      }
      let share = divRound(qd * w.after, sumAfter);
      if (share > w.after) share = w.after;
      w.share = share;
      allocated += share;
    }
  }
  let vat = BigInt(0);
  let grand = BigInt(0);
  const out = work.map((w) => {
    const net = w.after - w.share < BigInt(0) ? BigInt(0) : w.after - w.share;
    const v = pricesIncludeVat
      ? divRound(net * w.rate, BigInt(100_000) + w.rate)
      : divRound(net * w.rate, BigInt(100_000));
    const total = pricesIncludeVat ? net : net + v;
    vat += v;
    grand += total;
    return { total: centsToString(total), net: centsToString(net) };
  });
  return {
    lines: out,
    subtotal: centsToString(sumSub),
    discount: centsToString(sumDisc + qd),
    vat: centsToString(vat),
    grand: centsToString(grand),
  };
}

/** Left stripe + row tint per status (mirrors the jobs board colours). */
export function quoteStatusAccent(status: QuoteStatus): {
  stripe: string;
  row?: string;
} {
  switch (status) {
    case "draft":
      return { stripe: "bg-muted-foreground/30" };
    case "sent":
      return { stripe: "bg-sky-500" };
    case "viewed":
      return { stripe: "bg-amber-500" };
    case "accepted":
      return {
        stripe: "bg-emerald-500",
        row: "bg-emerald-500/[0.06] hover:bg-emerald-500/10",
      };
    case "rejected":
      return { stripe: "bg-rose-500" };
    default:
      return { stripe: "bg-muted-foreground/20" };
  }
}
