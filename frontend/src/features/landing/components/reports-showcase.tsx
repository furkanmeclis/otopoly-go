"use client";

import { useRef } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { motion, useInView } from "motion/react";

import { useLandingContent } from "@/features/landing/components/landing-content-provider";

/** Mini report card: weekly revenue bars grow in, service mix fills up. */
export function ReportsShowcase() {
  const { reportsSection, a11y } = useLandingContent();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });

  return (
    <div
      ref={ref}
      className="bg-card relative rounded-3xl border p-6 shadow-xl shadow-black/5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium">
            Bu hafta · Gelir
          </p>
          <p className="font-display mt-1 text-3xl font-semibold tracking-tight">
            ₺86.420
          </p>
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <ArrowUpRight className="size-3" />
            %18 geçen haftaya göre
          </p>
        </div>
        <span className="text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
          <Download className="size-3" /> PDF · XLSX
        </span>
      </div>

      <div
        className="mt-8 flex h-40 items-end gap-2 sm:gap-3"
        role="img"
        aria-label={a11y.weeklyChart}
      >
        {reportsSection.bars.map((bar, i) => (
          <div
            key={bar.label}
            className="flex flex-1 flex-col items-center gap-2"
          >
            <div className="relative flex h-32 w-full items-end">
              <motion.div
                initial={{ height: 0 }}
                animate={inView ? { height: `${bar.value}%` } : undefined}
                transition={{
                  delay: 0.2 + i * 0.07,
                  duration: 0.8,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={
                  bar.value === 100
                    ? "from-primary w-full rounded-lg bg-gradient-to-t to-[#F2B08F]"
                    : "bg-primary/20 w-full rounded-lg"
                }
              />
            </div>
            <span className="text-muted-foreground text-[11px]">
              {bar.label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3 border-t pt-5">
        <p className="text-sm font-medium">{reportsSection.mixTitle}</p>
        {reportsSection.mix.map((item, i) => (
          <div key={item.label}>
            <div className="flex justify-between text-xs">
              <span>{item.label}</span>
              <span className="text-muted-foreground">%{item.share}</span>
            </div>
            <div className="bg-muted mt-1 h-2 overflow-hidden rounded-full">
              <motion.div
                initial={{ width: 0 }}
                animate={inView ? { width: `${item.share * 2.2}%` } : undefined}
                transition={{
                  delay: 0.6 + i * 0.1,
                  duration: 0.9,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="bg-primary h-full rounded-full"
                style={{ opacity: 1 - i * 0.18 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
