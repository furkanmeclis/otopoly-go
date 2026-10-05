import {
  BetaLandingRoute,
  betaLandingMetadata,
} from "@/features/beta-landing/server";
import { landingViewport } from "@/features/landing/server";

export const metadata = betaLandingMetadata("tr");
export const viewport = landingViewport;

export default function BetaLandingPage() {
  return <BetaLandingRoute locale="tr" />;
}
