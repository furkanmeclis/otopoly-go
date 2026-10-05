import type { LandingLocale } from "@/features/landing/content";

export type BetaLandingChapter = {
  eyebrow: string;
  title: string;
  body: string;
};

export type BetaLandingContent = {
  locale: LandingLocale;
  meta: {
    title: string;
    description: string;
  };
  /** Navbar anchors; every target exists on the beta page. */
  nav: { href: string; label: string }[];
  /** The other locale's beta page (navbar language switch). */
  languageHref: string;
  film: {
    /** Accessible name of the film region. */
    label: string;
    scrollHint: string;
    /** Accessible name of the chapter rail; `{{n}}` is the chapter number. */
    chapterNav: string;
    goToChapter: string;
    /** Exactly six chapters, in storyboard order. */
    chapters: BetaLandingChapter[];
  };
};
