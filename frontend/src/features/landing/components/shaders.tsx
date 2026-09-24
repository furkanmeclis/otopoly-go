"use client";

import { useSyncExternalStore } from "react";
import { GrainGradient, MeshGradient } from "@paper-design/shaders-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/** Brand palette: espresso ink → terracotta → warm cream highlights. */
const HERO_COLORS = ["#1A1412", "#3B2019", "#EA6E43", "#8C3B20", "#F2B08F"];
const CTA_COLORS = ["#EA6E43", "#B84A26", "#F6C4A6"];

const noopSubscribe = () => () => {};

/** False during SSR/hydration, true on the client — keeps WebGL client-only. */
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * WebGL mesh gradient behind the hero. Renders client-only and fades in over
 * the CSS gradient fallback so first paint never waits on WebGL.
 */
export function HeroShader({ className }: { className?: string }) {
  const mounted = useMounted();
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 overflow-hidden bg-[radial-gradient(120%_80%_at_70%_20%,#EA6E43_0%,#8C3B20_30%,#1A1412_70%)]",
        className,
      )}
    >
      {mounted ? (
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        >
          <MeshGradient
            className="size-full"
            colors={HERO_COLORS}
            distortion={0.85}
            swirl={0.4}
            grainMixer={0.12}
            grainOverlay={0.08}
            speed={reduce ? 0 : 0.28}
            maxPixelCount={1920 * 1080}
          />
        </motion.div>
      ) : null}
    </div>
  );
}

/** Grainy animated gradient for the closing call-to-action band. */
export function CtaShader({ className }: { className?: string }) {
  const mounted = useMounted();
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#1A1412,#8C3B20)]",
        className,
      )}
    >
      {mounted ? (
        <GrainGradient
          className="size-full"
          colorBack="#1A1412"
          colors={CTA_COLORS}
          softness={0.7}
          intensity={0.45}
          noise={0.35}
          shape="corners"
          speed={reduce ? 0 : 0.6}
          maxPixelCount={1600 * 900}
        />
      ) : null}
    </div>
  );
}
