"use client";

import { useRef } from "react";
import { motion, useScroll, useSpring } from "motion/react";

import { steps } from "@/features/landing/content";
import { Reveal } from "@/features/landing/components/reveal";

/** Numbered steps joined by a line that fills as the section scrolls by. */
export function HowItWorks() {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 80%", "end 55%"],
  });
  const scaleY = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });

  return (
    <ol ref={ref} className="relative mx-auto mt-14 max-w-3xl space-y-10">
      <div
        aria-hidden
        className="bg-border absolute top-2 bottom-2 left-6 w-px sm:left-8"
      />
      <motion.div
        aria-hidden
        style={{ scaleY }}
        className="from-primary absolute top-2 bottom-2 left-6 w-px origin-top bg-gradient-to-b to-[#F2B08F] sm:left-8"
      />
      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-6 sm:gap-8">
          <Reveal delay={i * 0.05}>
            <span className="bg-background ring-primary/25 text-primary font-display relative z-10 grid size-12 place-items-center rounded-2xl text-lg font-semibold shadow-sm ring-1 sm:size-16 sm:text-xl">
              {String(i + 1).padStart(2, "0")}
            </span>
          </Reveal>
          <Reveal delay={i * 0.05 + 0.08} className="pt-1.5 sm:pt-3">
            <h3 className="font-display text-xl font-semibold tracking-tight">
              {step.title}
            </h3>
            <p className="text-muted-foreground mt-2 leading-relaxed">
              {step.description}
            </p>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
