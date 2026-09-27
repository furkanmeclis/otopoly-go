import { Plus } from "lucide-react";

import type { LandingContent } from "@/features/landing/content";
import { RevealGroup, RevealItem } from "@/features/landing/components/reveal";

/** Native <details> accordion: crawlable, keyboard-accessible, no JS needed. */
export function Faq({ faqs }: { faqs: LandingContent["faqs"] }) {
  return (
    <RevealGroup className="mx-auto mt-12 max-w-3xl space-y-3">
      {faqs.map((item) => (
        <RevealItem key={item.q}>
          <details className="group bg-card open:ring-primary/20 rounded-2xl border px-5 py-4 transition-shadow open:shadow-md open:ring-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
              <h3 className="text-base">{item.q}</h3>
              <span className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-full transition-transform duration-300 group-open:rotate-45">
                <Plus className="size-4" />
              </span>
            </summary>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              {item.a}
            </p>
          </details>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
