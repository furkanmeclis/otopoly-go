import { LandingRoute, landingMetadata } from "@/features/landing/server";

export const metadata = landingMetadata("en");

export default function PublicHomePageEn() {
  return <LandingRoute locale="en" />;
}
