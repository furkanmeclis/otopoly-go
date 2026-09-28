import {
  LandingRoute,
  landingMetadata,
  landingViewport,
} from "@/features/landing/server";

export const metadata = landingMetadata("en");
export const viewport = landingViewport;

export default function PublicHomePageEn() {
  return <LandingRoute locale="en" />;
}
