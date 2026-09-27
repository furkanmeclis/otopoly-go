"use client";

import {
  Banknote,
  Bell,
  CheckCheck,
  ClipboardList,
  FileSignature,
  MoonStar,
  PackageMinus,
  RotateCcw,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLandingContent } from "@/features/landing/components/landing-content-provider";
import { renderBold } from "@/features/landing/components/whatsapp-showcase";
import { fill, type JourneyEffectKind } from "@/features/landing/content";
import { cn } from "@/lib/utils";

const EFFECT_ICON: Record<JourneyEffectKind, typeof ClipboardList> = {
  job: ClipboardList,
  contract: FileSignature,
  stock: PackageMinus,
  team: Bell,
  cash: Banknote,
  summary: MoonStar,
};

const EFFECT_TONE: Record<JourneyEffectKind, string> = {
  job: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  contract: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  stock: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  team: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  cash: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  summary: "bg-primary/10 text-primary",
};

/**
 * "A day in the life of a car": the visitor steps one ceramic-coating job
 * through the shop. Each step shows the WhatsApp message the customer gets
 * and what Otopoly records by itself (stock, team alerts, cash, summary).
 * Nothing plays on its own — every change answers a click.
 */
export function CarJourney() {
  const { journey } = useLandingContent();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const last = journey.stages.length - 1;
  const done = journey.stages.slice(0, step + 1);
  const messages = done
    .filter((s) => s.message?.to === "customer")
    .map((s) => ({ ...s.message!, time: s.time }));
  const ownerMessage = done.find((s) => s.message?.to === "owner");
  const effects = done
    .flatMap((s, i) =>
      s.effects.map((e, j) => ({
        ...e,
        key: `${i}-${j}`,
        time: s.time,
        fresh: i === step,
      })),
    )
    .reverse();

  const enter = reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 };
  const spring = { type: "spring" as const, stiffness: 380, damping: 30 };

  return (
    <div className="mt-12 grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
      {/* Stage rail: a real sequence, so it is numbered. */}
      <div>
        <div className="bg-card rounded-2xl border p-4">
          <p className="font-mono text-lg font-semibold tracking-wider">
            {journey.plate}
          </p>
          <p className="text-muted-foreground text-sm">{journey.vehicle}</p>
        </div>
        <ol className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {journey.stages.map((stage, i) => {
            const state = i < step ? "past" : i === step ? "current" : "future";
            return (
              <li key={stage.label} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  aria-current={state === "current" ? "step" : undefined}
                  className={cn(
                    "focus-visible:ring-ring flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    state === "current" && "bg-primary text-primary-foreground",
                    state === "past" && "text-foreground hover:bg-muted",
                    state === "future" &&
                      "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums",
                      state === "current" && "bg-primary-foreground/20",
                      state === "past" && "bg-emerald-500 text-white",
                      state === "future" && "border",
                    )}
                  >
                    {state === "past" ? (
                      <CheckCheck className="size-3.5" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="whitespace-nowrap">{stage.label}</span>
                  <span className="ml-auto hidden text-xs tabular-nums opacity-70 lg:inline">
                    {stage.time}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex items-center gap-2">
          {step < last ? (
            <Button
              onClick={() => setStep((s) => Math.min(last, s + 1))}
              className="rounded-full"
            >
              {journey.next}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setStep(0)}
              className="rounded-full"
            >
              <RotateCcw className="size-4" />
              {journey.restart}
            </Button>
          )}
          <span
            className="text-muted-foreground text-xs tabular-nums"
            aria-live="polite"
          >
            {fill(journey.stepLabel, { n: step + 1, total: last + 1 })}
          </span>
        </div>
      </div>

      {/* Customer phone */}
      <div className="mx-auto w-full max-w-[20rem]">
        <p className="text-muted-foreground mb-2 text-center text-xs">
          {journey.customerPhone}
        </p>
        <div className="rounded-[2.2rem] border-[8px] border-neutral-900 bg-neutral-900 shadow-xl">
          <div className="overflow-hidden rounded-[1.7rem] bg-[#ECE5DD]">
            <div className="bg-[#075E54] px-4 pt-5 pb-3 text-sm font-semibold text-white">
              Tech Oto Detailing
            </div>
            <div
              className="flex h-[22rem] flex-col justify-end gap-2 overflow-hidden bg-[radial-gradient(#d9d2c9_1px,transparent_1px)] [background-size:14px_14px] p-3"
              aria-live="polite"
            >
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.title}
                    layout={!reduce}
                    initial={enter}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={spring}
                    className={cn(
                      "max-w-[90%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-neutral-800 shadow-sm",
                    )}
                  >
                    <p className="text-[11px] font-semibold text-[#075E54]">
                      {msg.title}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-snug">
                      {renderBold(msg.body)}
                    </p>
                    <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-400">
                      {msg.time}
                      <CheckCheck className="size-3 text-sky-500" />
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Background log: newest first, the step's own entries highlighted. */}
      <div>
        <p className="text-sm font-semibold">{journey.behindTitle}</p>
        <AnimatePresence initial={false}>
          {ownerMessage?.message ? (
            <motion.div
              key="owner"
              initial={enter}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={spring}
              className="mt-3 rounded-xl rounded-tr-sm bg-[#DCF8C6] px-3 py-2 text-neutral-800 shadow-sm"
            >
              <p className="text-[11px] font-semibold text-[#075E54]">
                {ownerMessage.message.title} · {journey.ownerPhone}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug">
                {ownerMessage.message.body}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <ul className="mt-3 space-y-2">
          <AnimatePresence initial={false}>
            {effects.map((effect) => {
              const Icon = EFFECT_ICON[effect.kind];
              return (
                <motion.li
                  key={effect.key}
                  layout={!reduce}
                  initial={enter}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
                    effect.fresh
                      ? "bg-card shadow-sm"
                      : "bg-muted/40 text-muted-foreground border-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg",
                      EFFECT_TONE[effect.kind],
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="flex-1 leading-snug">{effect.text}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {effect.time}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}
