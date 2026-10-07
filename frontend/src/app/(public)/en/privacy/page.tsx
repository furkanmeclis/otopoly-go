import { PrivacyRoute, privacyMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return privacyMetadata("en");
}

export default function PrivacyPageEn() {
  return <PrivacyRoute locale="en" />;
}
