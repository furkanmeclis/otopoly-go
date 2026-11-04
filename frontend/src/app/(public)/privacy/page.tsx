import { LegalRoute, legalMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return legalMetadata("privacy", "tr");
}

export default function PrivacyPage() {
  return <LegalRoute slug="privacy" locale="tr" />;
}
