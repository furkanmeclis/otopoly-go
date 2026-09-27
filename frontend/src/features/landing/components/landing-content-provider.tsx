"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

import type { LandingContent, PublicPlan } from "@/features/landing/content";

type LandingContextValue = { content: LandingContent; plans: PublicPlan[] };

const LandingContext = createContext<LandingContextValue | null>(null);

export function LandingContentProvider({
  content,
  plans,
  children,
}: LandingContextValue & { children: ReactNode }) {
  // The root layout renders <html lang="tr"> and the app locale provider
  // re-applies the visitor's app language after us; keep the page's own
  // language while the landing is mounted.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    const apply = () => {
      if (root.lang !== content.htmlLang) root.lang = content.htmlLang;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["lang"] });
    return () => {
      observer.disconnect();
      root.lang = previous;
    };
  }, [content.htmlLang]);

  return (
    <LandingContext.Provider value={{ content, plans }}>
      {children}
    </LandingContext.Provider>
  );
}

export function useLandingContent(): LandingContent {
  const ctx = useContext(LandingContext);
  if (!ctx)
    throw new Error(
      "useLandingContent must be used within LandingContentProvider",
    );
  return ctx.content;
}

export function useLandingPlans(): PublicPlan[] {
  return useContext(LandingContext)?.plans ?? [];
}
