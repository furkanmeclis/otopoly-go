import { LandingRoute, landingMetadata } from "@/features/landing/server";

export const metadata = landingMetadata("tr");

export default function PublicHomePage() {
  return <LandingRoute locale="tr" />;
}
