import type { BetaLandingContent } from "./types";

export const en: BetaLandingContent = {
  locale: "en",
  meta: {
    title: "Otopoly — One flow from check-in to hand-over",
    description:
      "Plate-based check-in, work orders, a live operations board, WhatsApp updates from your own number, OTP-verified digital contracts and a day that closes its own books.",
  },
  nav: [
    { href: "#film", label: "How it works" },
    { href: "#fiyatlar", label: "Pricing" },
    { href: "#sss", label: "FAQ" },
  ],
  languageHref: "/beta-landing",
  film: {
    label: "A working day with Otopoly",
    scrollHint: "Scroll",
    chapterNav: "Chapters",
    goToChapter: "Go to chapter {{n}}",
    chapters: [
      {
        eyebrow: "Check-in by plate",
        title: "A car pulls in. Your whole shop runs from one screen.",
        body: "Type the plate and the customer, the car's history and a new job open in seconds. No notebooks, paper tickets or lost notes between arrival and hand-over.",
      },
      {
        eyebrow: "Work order",
        title: "Services and staff, on a single card.",
        body: "Wash, ceramic coating, interior detail… every item gets its own line and every job an owner. Finished steps are ticked off with one tap.",
      },
      {
        eyebrow: "Live board",
        title: "Which car, which stage? See it at a glance.",
        body: "Waiting, in progress and ready each get their own column. Move a card forward and the whole team sees the new status instantly.",
      },
      {
        eyebrow: "WhatsApp updates",
        title: "Customers hear from your own number.",
        body: "The moment a car is ready, the message goes out by itself. Fewer “is it done yet?” calls, more time on the floor.",
      },
      {
        eyebrow: "Digital contract",
        title: "Signed on the tablet. Verified by code.",
        body: "For ceramic and PPF jobs, customers sign on a tablet and confirm with a one-time code sent to their phone. The PDF stays on the job card.",
      },
      {
        eyebrow: "Cash and reports",
        title: "The day closes its own books.",
        body: "Payments, open balances and the day's revenue add themselves up. One look in the evening tells you what you earned.",
      },
    ],
  },
};
