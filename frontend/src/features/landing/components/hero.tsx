"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { useLandingContent } from "@/features/landing/components/landing-content-provider";
import { ProductMock } from "@/features/landing/components/product-mock";
import { HeroShader } from "@/features/landing/components/shaders";

const EASE = [0.22, 1, 0.36, 1] as const;

const ACCENT_GRADIENT = "linear-gradient(90deg, #FFD2B8, #F59A6F, #EA6E43)";

function Words({
  text,
  delay,
  gradient,
}: {
  text: string;
  delay: number;
  /**
   * Gradient text, painted on each word's own span: WebKit (iOS Safari) does
   * not carry a parent's `background-clip: text` into the transformed
   * inline-block word layers, which left the accent invisible on iPhone.
   * Each word shows its slice of one wide gradient so the sweep stays
   * continuous across the phrase.
   */
  gradient?: string;
}) {
  const words = text.split(" ");
  return (
    <span>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          className="inline-block overflow-hidden pb-[0.12em] align-bottom"
        >
          <motion.span
            className={
              gradient
                ? "inline-block bg-clip-text text-transparent [-webkit-background-clip:text] [-webkit-text-fill-color:transparent]"
                : "inline-block"
            }
            style={
              gradient
                ? {
                    backgroundImage: gradient,
                    backgroundSize: `${words.length * 100}% 100%`,
                    backgroundPosition: `${words.length > 1 ? (i / (words.length - 1)) * 100 : 0}% 0`,
                  }
                : undefined
            }
            initial={{ y: "110%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: delay + i * 0.06 }}
          >
            {word}
            {" "}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

export function Hero() {
  const { hero } = useLandingContent();
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const mockY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 120]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  // Pointer-driven 3D tilt for the product preview.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-8, 8]), {
    stiffness: 120,
    damping: 18,
  });
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), {
    stiffness: 120,
    damping: 18,
  });

  return (
    <section
      ref={sectionRef}
      className="relative isolate overflow-hidden bg-[#1A1412] text-white"
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const rect = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - rect.left) / rect.width - 0.5);
        py.set((e.clientY - rect.top) / rect.height - 0.5);
      }}
      onPointerLeave={() => {
        px.set(0);
        py.set(0);
      }}
    >
      <HeroShader />
      {/* Legibility: darken the text side, fade into the page below. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(100deg,rgba(26,20,18,0.85)_0%,rgba(26,20,18,0.55)_45%,rgba(26,20,18,0.1)_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] [background-size:56px_56px]"
      />
      <div
        aria-hidden
        className="to-background absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pt-32 pb-28 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-40 lg:pb-40">
        <motion.div style={{ opacity: contentOpacity }}>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur"
          >
            <span className="size-1.5 rounded-full bg-[#EA6E43] shadow-[0_0_12px_#EA6E43]" />
            {hero.eyebrow}
          </motion.p>

          <h1 className="font-display mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            <Words text={hero.titleLead} delay={0.1} />
            <Words
              text={hero.titleAccent}
              delay={0.35}
              gradient={ACCENT_GRADIENT}
            />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.7 }}
            className="mt-6 max-w-xl text-base leading-relaxed text-white/75 sm:text-lg"
          >
            {hero.description}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.85 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <Button
              asChild
              size="lg"
              className="group h-12 rounded-full px-6 text-base shadow-[0_10px_40px_-10px_#EA6E43]"
            >
              <Link href={routes.public.register}>
                {hero.primaryCta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-white/25 bg-white/5 px-6 text-base text-white backdrop-blur hover:bg-white/15 hover:text-white"
            >
              <Link href="/login">{hero.secondaryCta}</Link>
            </Button>
          </motion.div>

          <motion.ul
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.08, delayChildren: 1 } },
            }}
            className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70"
          >
            {hero.trust.map((item) => (
              <motion.li
                key={item}
                variants={{
                  hidden: { opacity: 0, x: -6 },
                  show: { opacity: 1, x: 0 },
                }}
                className="flex items-center gap-1.5"
              >
                <Check className="size-4 text-[#F59A6F]" />
                {item}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: EASE, delay: 0.4 }}
          style={{ y: mockY }}
          className="[perspective:1400px]"
        >
          <motion.div
            style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
          >
            <ProductMock />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
