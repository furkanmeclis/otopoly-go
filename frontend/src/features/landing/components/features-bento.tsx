"use client";

import type { PointerEvent } from "react";
import {
  BarChart3,
  Boxes,
  Check,
  ClipboardList,
  FileSignature,
  HandCoins,
  MessageCircle,
  UserCog,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

import { features, type FeatureIcon } from "@/features/landing/content";
import { RevealGroup, RevealItem } from "@/features/landing/components/reveal";
import { cn } from "@/lib/utils";

const ICONS: Record<FeatureIcon, LucideIcon> = {
  jobs: ClipboardList,
  whatsapp: MessageCircle,
  contract: FileSignature,
  cari: HandCoins,
  finance: Wallet,
  stock: Boxes,
  reports: BarChart3,
  staff: UserCog,
};

function trackPointer(e: PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
}

/** Bento grid of product capabilities with a pointer-following spotlight. */
export function FeaturesBento() {
  return (
    <RevealGroup className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {features.map((feature) => {
        const Icon = ICONS[feature.icon];
        const large = feature.size === "lg";
        return (
          <RevealItem
            key={feature.title}
            className={cn(large && "sm:col-span-2")}
          >
            <motion.article
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              onPointerMove={trackPointer}
              className="group bg-card relative h-full overflow-hidden rounded-3xl border p-6 shadow-sm"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(420px circle at var(--x) var(--y), color-mix(in oklch, var(--primary) 16%, transparent), transparent 60%)",
                }}
              />
              <div className="relative">
                <span className="bg-primary/10 text-primary ring-primary/20 grid size-11 place-items-center rounded-2xl ring-1 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-6deg]">
                  <Icon className="size-5" />
                </span>
                <h3
                  className={cn(
                    "font-display mt-5 font-semibold tracking-tight",
                    large ? "text-2xl" : "text-lg",
                  )}
                >
                  {feature.title}
                </h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {feature.description}
                </p>
                <ul
                  className={cn(
                    "mt-4 flex flex-wrap gap-2",
                    !large && "flex-col gap-1.5",
                  )}
                >
                  {feature.points.map((point) => (
                    <li
                      key={point}
                      className={cn(
                        "text-foreground/80 flex items-center gap-1.5 text-xs font-medium",
                        large && "bg-muted rounded-full px-3 py-1",
                      )}
                    >
                      <Check className="text-primary size-3.5" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.article>
          </RevealItem>
        );
      })}
    </RevealGroup>
  );
}
