import { LegalRoute, legalMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return legalMetadata("terms", "tr");
}

export default function TermsPage() {
  return <LegalRoute slug="terms" locale="tr" />;
}
