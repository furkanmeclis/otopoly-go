import { LegalRoute, legalMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return legalMetadata("privacy", "en");
}

export default function PrivacyPageEn() {
  return <LegalRoute slug="privacy" locale="en" />;
}
