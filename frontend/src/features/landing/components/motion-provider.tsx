"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";

/** Honour the OS "reduce motion" setting for every landing animation. */
export function LandingMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
