"use client";

import { useRef } from "react";
import { CheckCheck, ChevronLeft, Phone } from "lucide-react";
import { motion, useInView } from "motion/react";

import { AppMark } from "@/components/brand/app-mark";
import { whatsappMessages } from "@/features/landing/content";

function renderBold(text: string) {
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("*") && part.endsWith("*") ? (
      <strong key={i} className="font-semibold tracking-wider">
        {part.slice(1, -1)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Phone mock where the day's customer messages arrive one by one. */
export function WhatsAppShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[340px]">
      <div
        aria-hidden
        className="bg-primary/25 absolute -inset-10 -z-10 rounded-full blur-3xl"
      />
      <motion.div
        initial={{ opacity: 0, y: 40, rotate: -4 }}
        animate={inView ? { opacity: 1, y: 0, rotate: -2 } : undefined}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[2.6rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl"
      >
        <div className="overflow-hidden rounded-[2rem] bg-[#ECE5DD]">
          <div className="flex items-center gap-2 bg-[#075E54] px-3 pt-6 pb-3 text-white">
            <ChevronLeft className="size-5" />
            <span
              className="grid size-8 place-items-center rounded-full bg-white"
              style={{ "--brand-glyph": "#241C18" } as React.CSSProperties}
            >
              <AppMark className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                Tech Oto Detailing
              </p>
              <p className="text-[11px] text-white/75">işletme hesabı</p>
            </div>
            <Phone className="size-4" />
          </div>
          <div className="flex min-h-[420px] flex-col gap-2.5 bg-[radial-gradient(#d9d2c9_1px,transparent_1px)] [background-size:14px_14px] p-3">
            <span className="mx-auto rounded-md bg-white/80 px-2 py-0.5 text-[10px] text-neutral-500 shadow-sm">
              BUGÜN
            </span>
            {whatsappMessages.map((msg, i) => (
              <motion.div
                key={msg.title}
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={inView ? { opacity: 1, y: 0, scale: 1 } : undefined}
                transition={{
                  delay: 0.6 + i * 0.7,
                  type: "spring",
                  stiffness: 380,
                  damping: 28,
                }}
                className="max-w-[88%] origin-top-left rounded-xl rounded-tl-sm bg-white px-3 py-2 text-neutral-800 shadow-sm"
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
          </div>
        </div>
      </motion.div>
    </div>
  );
}
