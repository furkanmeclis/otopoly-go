"use client";

import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { services } from "@/features/landing/content";

/** Infinite marquee of the service types Otopoly is built for. */
export function ServicesMarquee() {
  const reduce = useReducedMotion();
  const row = [...services, ...services];
  return (
    <section
      aria-label="Desteklenen hizmetler"
      className="border-border/60 relative overflow-hidden border-y py-6"
    >
      <p className="sr-only">
        Otopoly ile yönetebileceğiniz hizmetler: {services.join(", ")}.
      </p>
      <div
        className="[mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]"
        aria-hidden
      >
        <motion.ul
          className="flex w-max gap-10"
          animate={reduce ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 40, ease: "linear", repeat: Infinity }}
        >
          {row.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="text-muted-foreground font-display flex items-center gap-10 text-lg font-medium whitespace-nowrap sm:text-xl"
            >
              {item}
              <Sparkles className="text-primary size-4" />
            </li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
