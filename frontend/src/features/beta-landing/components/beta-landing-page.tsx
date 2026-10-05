import type { BetaLandingContent } from "@/features/beta-landing/content";
import { ScrollFilm } from "@/features/beta-landing/components/scroll-film";
import { Faq } from "@/features/landing/components/faq";
import { FinalCta } from "@/features/landing/components/final-cta";
import { LandingContentProvider } from "@/features/landing/components/landing-content-provider";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { LandingNavbar } from "@/features/landing/components/landing-navbar";
import { LandingMotionProvider } from "@/features/landing/components/motion-provider";
import { Pricing } from "@/features/landing/components/pricing";
import { SectionHeading } from "@/features/landing/components/section-heading";
import type { LandingContent, PublicPlan } from "@/features/landing/content";

export function BetaLandingPage({
  betaContent,
  landingContent,
  plans,
}: {
  betaContent: BetaLandingContent;
  landingContent: LandingContent;
  plans: PublicPlan[];
}) {
  const content: LandingContent = {
    ...landingContent,
    language: {
      ...landingContent.language,
      href: betaContent.languageHref,
    },
    nav: betaContent.nav,
  };

  return (
    <LandingContentProvider content={content} plans={plans}>
      <LandingMotionProvider>
        {/* No `data-landing`: that marker paints the page chrome in the dark
            hero colour, while this page follows the light/dark theme. */}
        <div className="bg-background text-foreground min-h-svh overflow-x-clip">
          <LandingNavbar overDarkHero={false} />
          <main>
            <ScrollFilm content={betaContent.film} hero={landingContent.hero} />

            <section
              id="fiyatlar"
              className="bg-muted/40 scroll-mt-24 border-y px-4 py-24 sm:px-6"
            >
              <div className="mx-auto max-w-6xl">
                <SectionHeading
                  eyebrow={landingContent.pricing.eyebrow}
                  title={landingContent.pricing.title}
                  description={landingContent.pricing.description}
                />
                <Pricing />
              </div>
            </section>

            <section id="sss" className="scroll-mt-24 px-4 py-24 sm:px-6">
              <SectionHeading
                eyebrow={landingContent.sections.faq.eyebrow}
                title={landingContent.sections.faq.title}
                description={landingContent.sections.faq.description}
              />
              <Faq faqs={landingContent.faqs} />
            </section>

            <FinalCta />
          </main>
          <LandingFooter content={content} />
        </div>
      </LandingMotionProvider>
    </LandingContentProvider>
  );
}
