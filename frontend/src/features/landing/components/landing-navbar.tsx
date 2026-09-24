"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from "motion/react";

import { AppWordmark } from "@/components/brand/app-wordmark";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { hero, landingNav } from "@/features/landing/content";
import { cn } from "@/lib/utils";

/** Transparent over the dark hero, frosted glass once the page scrolls. */
export function LandingNavbar() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 24));
  const onDark = !scrolled && !open;

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6"
    >
      <nav
        aria-label="Ana menü"
        style={
          onDark
            ? ({ "--brand-glyph": "#fff" } as React.CSSProperties)
            : undefined
        }
        className={cn(
          "mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl border px-4 py-2.5 transition-all duration-300",
          onDark
            ? "border-transparent text-white"
            : "border-border/60 bg-background/75 text-foreground shadow-lg shadow-black/5 backdrop-blur-xl",
        )}
      >
        <Link href={routes.public.root} aria-label="Otopoly ana sayfa">
          <AppWordmark className="h-6 sm:h-7" />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {landingNav.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  onDark
                    ? "text-white/80 hover:bg-white/10 hover:text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn(
              onDark && "text-white hover:bg-white/10 hover:text-white",
            )}
          >
            <Link href="/login">{hero.secondaryCta}</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full px-4">
            <Link href={routes.public.register}>{hero.primaryCta}</Link>
          </Button>
        </div>

        <button
          type="button"
          className="rounded-lg p-2 md:hidden"
          aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="border-border/60 bg-background/95 mx-auto mt-2 max-w-6xl rounded-2xl border p-3 shadow-xl backdrop-blur-xl md:hidden"
          >
            <ul className="flex flex-col">
              {landingNav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="hover:bg-muted block rounded-lg px-3 py-2.5 text-sm font-medium"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button asChild variant="outline">
                <Link href="/login">{hero.secondaryCta}</Link>
              </Button>
              <Button asChild>
                <Link href={routes.public.register}>{hero.primaryCta}</Link>
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.header>
  );
}
