"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { useLandingContent } from "@/features/landing/components/landing-content-provider";
import { CtaShader } from "@/features/landing/components/shaders";

export function FinalCta() {
  const { finalCta, hero } = useLandingContent();
  return (
    <section className="px-4 py-24 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.97 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-16 text-center text-white shadow-2xl sm:px-12 sm:py-24"
      >
        <CtaShader className="-z-10" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(26,20,18,0.35),rgba(26,20,18,0.75))]"
        />
        <h2 className="font-display mx-auto max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
          {finalCta.title}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base text-white/80 sm:text-lg">
          {finalCta.description}
        </p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="group h-12 rounded-full bg-white px-7 text-base text-neutral-900 hover:bg-white/90"
          >
            <Link href={routes.public.register}>
              {finalCta.cta}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 rounded-full border-white/30 bg-white/5 px-7 text-base text-white hover:bg-white/15 hover:text-white"
          >
            <Link href="/login">{hero.secondaryCta}</Link>
          </Button>
        </div>
      </motion.div>
    </section>
  );
}
