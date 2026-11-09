import { SupportPage, supportMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return supportMetadata("en");
}

export default function SupportRouteEn() {
  return <SupportPage locale="en" />;
}
