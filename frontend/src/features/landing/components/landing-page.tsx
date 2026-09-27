import { Check } from "lucide-react";

import type { LandingContent, PublicPlan } from "@/features/landing/content";
import { CarJourney } from "@/features/landing/components/car-journey";
import { LandingContentProvider } from "@/features/landing/components/landing-content-provider";
import { Pricing } from "@/features/landing/components/pricing";
import { Faq } from "@/features/landing/components/faq";
import { FeaturesBento } from "@/features/landing/components/features-bento";
import { FinalCta } from "@/features/landing/components/final-cta";
import { Hero } from "@/features/landing/components/hero";
import { HowItWorks } from "@/features/landing/components/how-it-works";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { LandingNavbar } from "@/features/landing/components/landing-navbar";
import { LandingMotionProvider } from "@/features/landing/components/motion-provider";
import { ReportsShowcase } from "@/features/landing/components/reports-showcase";
import { RevealGroup, RevealItem } from "@/features/landing/components/reveal";
import { SectionHeading } from "@/features/landing/components/section-heading";
import { ServicesMarquee } from "@/features/landing/components/services-marquee";
import { WhatsAppShowcase } from "@/features/landing/components/whatsapp-showcase";

function PointList({ points }: { points: readonly string[] }) {
  return (
    <RevealGroup className="mt-8 space-y-3">
      {points.map((point) => (
        <RevealItem key={point} className="flex items-start gap-3">
          <span className="bg-primary/10 text-primary mt-0.5 grid size-6 shrink-0 place-items-center rounded-full">
            <Check className="size-3.5" />
          </span>
          <span className="text-foreground/85">{point}</span>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

export function LandingPage({
  content,
  plans,
}: {
  content: LandingContent;
  plans: PublicPlan[];
}) {
  const { sections, whatsappSection, reportsSection, journey, pricing, faqs } =
    content;
  return (
    <LandingContentProvider content={content} plans={plans}>
      <LandingMotionProvider>
        <div className="bg-background text-foreground min-h-svh overflow-x-clip">
          <LandingNavbar />
          <main>
            <Hero />
            <ServicesMarquee />

            <section
              id="ozellikler"
              className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6"
            >
              <SectionHeading
                eyebrow={sections.features.eyebrow}
                title={sections.features.title}
                description={sections.features.description}
              />
              <FeaturesBento />
            </section>

            <section id="bir-gun" className="bg-muted/40 scroll-mt-24 border-y">
              <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
                <SectionHeading
                  align="left"
                  eyebrow={journey.eyebrow}
                  title={journey.title}
                  description={journey.description}
                />
                <CarJourney />
              </div>
            </section>

            <section id="whatsapp" className="scroll-mt-24">
              <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 py-24 sm:px-6 lg:grid-cols-2">
                <div>
                  <SectionHeading
                    align="left"
                    eyebrow={whatsappSection.eyebrow}
                    title={whatsappSection.title}
                    description={whatsappSection.description}
                  />
                  <PointList points={whatsappSection.points} />
                </div>
                <WhatsAppShowcase />
              </div>
            </section>

            <section
              id="nasil-calisir"
              className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6"
            >
              <SectionHeading
                eyebrow={sections.how.eyebrow}
                title={sections.how.title}
                description={sections.how.description}
              />
              <HowItWorks />
            </section>

            <section className="mx-auto grid max-w-6xl items-center gap-16 px-4 pb-24 sm:px-6 lg:grid-cols-2">
              <div className="order-2 lg:order-1">
                <ReportsShowcase />
              </div>
              <div className="order-1 lg:order-2">
                <SectionHeading
                  align="left"
                  eyebrow={reportsSection.eyebrow}
                  title={reportsSection.title}
                  description={reportsSection.description}
                />
              </div>
            </section>

            <section
              id="fiyatlar"
              className="bg-muted/40 scroll-mt-24 border-y px-4 py-24 sm:px-6"
            >
              <div className="mx-auto max-w-6xl">
                <SectionHeading
                  eyebrow={pricing.eyebrow}
                  title={pricing.title}
                  description={pricing.description}
                />
                <Pricing />
              </div>
            </section>

            <section id="sss" className="scroll-mt-24 px-4 py-24 sm:px-6">
              <SectionHeading
                eyebrow={sections.faq.eyebrow}
                title={sections.faq.title}
                description={sections.faq.description}
              />
              <Faq faqs={faqs} />
            </section>

            <FinalCta />
          </main>
          <LandingFooter content={content} />
        </div>
      </LandingMotionProvider>
    </LandingContentProvider>
  );
}
