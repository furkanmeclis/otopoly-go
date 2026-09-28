import {
  LandingRoute,
  landingMetadata,
  landingViewport,
} from "@/features/landing/server";

export const metadata = landingMetadata("tr");
export const viewport = landingViewport;

export default function PublicHomePage() {
  return <LandingRoute locale="tr" />;
}
