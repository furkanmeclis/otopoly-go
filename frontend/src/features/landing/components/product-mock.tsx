"use client";

import { useEffect, useReducer } from "react";
import {
  CheckCheck,
  FileSignature,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

import { cn } from "@/lib/utils";
import { useLandingContent } from "@/features/landing/components/landing-content-provider";
import { fill } from "@/features/landing/content";

type Stage = 0 | 1 | 2;

type JobCard = {
  id: number;
  plate: string;
  vehicle: string;
  service: string;
  price: string;
  staff: string;
  stage: Stage;
};

const COLUMNS = [
  { title: "İşlemde", dot: "bg-amber-400" },
  { title: "Hazır", dot: "bg-emerald-400" },
  { title: "Teslim", dot: "bg-sky-400" },
] as const;

const QUEUE: Omit<JobCard, "id" | "stage">[] = [
  {
    plate: "34 TKO 34",
    vehicle: "Toyota Corolla",
    service: "Seramik kaplama",
    price: "₺4.250",
    staff: "AU",
  },
  {
    plate: "06 BRK 061",
    vehicle: "VW Passat",
    service: "Detaylı iç temizlik",
    price: "₺1.400",
    staff: "MK",
  },
  {
    plate: "35 EGE 35",
    vehicle: "Renault Clio",
    service: "İç-dış yıkama",
    price: "₺450",
    staff: "SY",
  },
  {
    plate: "16 BRS 116",
    vehicle: "BMW 320i",
    service: "Pasta cila",
    price: "₺2.100",
    staff: "AU",
  },
  {
    plate: "41 KCL 41",
    vehicle: "Fiat Egea",
    service: "Motor yıkama",
    price: "₺600",
    staff: "MK",
  },
  {
    plate: "34 PPF 07",
    vehicle: "Tesla Model Y",
    service: "PPF kaplama",
    price: "₺38.000",
    staff: "SY",
  },
];

type BoardState = {
  cards: JobCard[];
  next: number;
  revenue: number;
  /** Plate + tick of the last car that became ready (drives the WhatsApp toast). */
  ready: { plate: string; tick: number } | null;
  tick: number;
};

const INITIAL: BoardState = {
  cards: [
    { ...QUEUE[0], id: 0, stage: 0 },
    { ...QUEUE[1], id: 1, stage: 0 },
    { ...QUEUE[2], id: 2, stage: 1 },
    { ...QUEUE[3], id: 3, stage: 2 },
  ],
  next: 4,
  revenue: 18450,
  ready: null,
  tick: 0,
};

/** Pure board step: advance the oldest open card, keep ≤2 delivered, refill. */
function step(state: BoardState): BoardState {
  const tick = state.tick + 1;
  const moving = state.cards.find((c) => c.stage < 2);
  if (!moving) return state;
  let cards = state.cards.map((c) =>
    c.id === moving.id ? { ...c, stage: (c.stage + 1) as Stage } : c,
  );
  const delivered = cards.filter((c) => c.stage === 2);
  if (delivered.length > 2) {
    cards = cards.filter((c) => c.id !== delivered[0].id);
  }
  let next = state.next;
  if (cards.filter((c) => c.stage === 0).length < 2) {
    cards = [...cards, { ...QUEUE[next % QUEUE.length], id: next, stage: 0 }];
    next += 1;
  }
  return {
    cards,
    next,
    tick,
    revenue:
      moving.stage === 1
        ? state.revenue + Number(moving.price.replace(/[^\d]/g, ""))
        : state.revenue,
    ready: moving.stage === 0 ? { plate: moving.plate, tick } : state.ready,
  };
}

function Counter({ to, locale }: { to: number; locale: string }) {
  const value = useMotionValue(0);
  const text = useTransform(value, (v) => Math.round(v).toLocaleString(locale));
  useEffect(() => {
    const controls = animate(value, to, { duration: 1.6, ease: "easeOut" });
    return () => controls.stop();
  }, [to, value]);
  return <motion.span>{text}</motion.span>;
}

/**
 * Stylised operations board: jobs flow İşlemde → Hazır → Teslim while
 * WhatsApp / contract notifications pop around it.
 */
export function ProductMock({ className }: { className?: string }) {
  const { productMock } = useLandingContent();
  const job = (id: number) => productMock.jobs[id % productMock.jobs.length];
  const reduce = useReducedMotion();
  const [board, dispatch] = useReducer(step, INITIAL);
  const { cards, revenue, ready } = board;

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(dispatch, 2600);
    return () => window.clearInterval(id);
  }, [reduce]);

  // The WhatsApp toast lives for the tick in which a car became ready.
  const toast = ready && ready.tick === board.tick ? ready : null;

  return (
    <div className={cn("relative", className)}>
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] shadow-2xl shadow-black/40 backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-white/25" />
            <span className="size-2.5 rounded-full bg-white/25" />
            <span className="size-2.5 rounded-full bg-white/25" />
          </div>
          <p className="text-xs font-medium text-white/70">
            {productMock.title}
          </p>
          <div className="flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            Canlı
          </div>
        </div>

        <LayoutGroup>
          <div className="grid grid-cols-3 gap-2 p-3 sm:gap-3 sm:p-4">
            {COLUMNS.map((col, stage) => {
              const items = cards.filter((c) => c.stage === stage);
              return (
                <div
                  key={productMock.columns[stage]}
                  className="min-h-[220px] rounded-xl bg-black/15 p-2 sm:min-h-[250px]"
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
                      <span className={cn("size-1.5 rounded-full", col.dot)} />
                      {col.title}
                    </span>
                    <span className="text-[10px] text-white/50">
                      {items.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <AnimatePresence mode="popLayout">
                      {items.map((card) => (
                        <motion.div
                          key={card.id}
                          layoutId={`job-${card.id}`}
                          layout
                          initial={{ opacity: 0, scale: 0.9, y: -8 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 32,
                          }}
                          className="rounded-lg border border-white/10 bg-white/[0.09] p-2 text-white"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="rounded bg-white px-1 font-mono text-[9px] font-semibold whitespace-nowrap text-neutral-900 sm:text-[10px] sm:tracking-wide">
                              {card.plate}
                            </span>
                            <span className="hidden size-5 shrink-0 place-items-center rounded-full bg-[#EA6E43] text-[8px] font-bold sm:grid">
                              {card.staff}
                            </span>
                          </div>
                          <p className="mt-1.5 truncate text-[11px] font-medium">
                            {job(card.id).service}
                          </p>
                          <div className="mt-0.5 flex items-center justify-between text-[10px] text-white/55">
                            <span className="truncate">
                              {job(card.id).vehicle}
                            </span>
                            <span className="text-white/80">
                              {job(card.id).price}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
        </LayoutGroup>
      </div>

      {/* Revenue KPI */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.1, duration: 0.6 }}
        className="absolute -bottom-6 -left-3 flex items-center gap-3 rounded-2xl border border-white/15 bg-neutral-950/70 px-4 py-3 text-white shadow-xl backdrop-blur-xl sm:-left-8"
      >
        <span className="grid size-9 place-items-center rounded-xl bg-emerald-400/15 text-emerald-300">
          <TrendingUp className="size-4" />
        </span>
        <div>
          <p className="text-[10px] text-white/60">
            {productMock.revenueToday}
          </p>
          <p className="font-display text-lg font-semibold">
            ₺<Counter to={revenue} locale={productMock.numberLocale} />
          </p>
        </div>
      </motion.div>

      {/* Contract badge */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.4, duration: 0.6 }}
        className="absolute -top-12 right-2 flex items-center gap-2 rounded-full border border-white/15 bg-neutral-950/70 py-1.5 pr-3 pl-1.5 text-xs text-white shadow-xl backdrop-blur-xl"
      >
        <span className="grid size-6 place-items-center rounded-full bg-[#EA6E43]">
          <FileSignature className="size-3.5" />
        </span>
        Sözleşme imzalandı
        <ShieldCheck className="size-3.5 text-emerald-300" />
      </motion.div>

      {/* WhatsApp toast when a car becomes ready */}
      <AnimatePresence>
        {toast ? (
          <motion.div
            key={toast.tick}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="absolute right-2 -bottom-8 w-60 rounded-2xl rounded-br-sm bg-[#DCF8C6] px-3 py-2 text-neutral-900 shadow-2xl sm:-right-10"
          >
            <p className="text-[10px] font-semibold text-emerald-700">
              WhatsApp · Otopoly
            </p>
            <p className="mt-0.5 text-xs leading-snug">
              {fill(productMock.readyToast, { plate: toast.plate })}
            </p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
              {productMock.now} <CheckCheck className="size-3 text-sky-500" />
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
