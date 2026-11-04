import { LegalRoute, legalMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return legalMetadata("terms", "en");
}

export default function TermsPageEn() {
  return <LegalRoute slug="terms" locale="en" />;
}
