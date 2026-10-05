import {
  BetaLandingRoute,
  betaLandingMetadata,
} from "@/features/beta-landing/server";
import { landingViewport } from "@/features/landing/server";

export const metadata = betaLandingMetadata("en");
export const viewport = landingViewport;

export default function BetaLandingPageEn() {
  return <BetaLandingRoute locale="en" />;
}
