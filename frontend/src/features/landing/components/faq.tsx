import { Plus } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { LandingContent } from "@/features/landing/content";
import { RevealGroup, RevealItem } from "@/features/landing/components/reveal";

/**
 * FAQ accordion. Answers stay in the server-rendered HTML while closed
 * (`forceMount` + `hidden`), so they remain crawlable.
 */
export function Faq({ faqs }: { faqs: LandingContent["faqs"] }) {
  return (
    <RevealGroup className="mx-auto mt-12 max-w-3xl space-y-3">
      {faqs.map((item) => (
        <RevealItem key={item.q}>
          <Collapsible className="group bg-card data-[state=open]:ring-primary/20 rounded-2xl border px-5 py-4 transition-shadow data-[state=open]:shadow-md data-[state=open]:ring-1">
            <h3 className="text-base font-medium">
              <CollapsibleTrigger className="focus-visible:ring-ring flex w-full cursor-pointer items-center justify-between gap-4 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none">
                <span>{item.q}</span>
                <span className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-full transition-transform duration-300 group-data-[state=open]:rotate-45">
                  <Plus className="size-4" />
                </span>
              </CollapsibleTrigger>
            </h3>
            <CollapsibleContent
              forceMount
              className="data-[state=closed]:hidden"
            >
              <p className="text-muted-foreground mt-3 leading-relaxed">
                {item.a}
              </p>
            </CollapsibleContent>
          </Collapsible>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
