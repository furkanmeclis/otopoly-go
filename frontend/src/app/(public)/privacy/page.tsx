import { PrivacyRoute, privacyMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return privacyMetadata("tr");
}

export default function PrivacyPage() {
  return <PrivacyRoute locale="tr" />;
}
