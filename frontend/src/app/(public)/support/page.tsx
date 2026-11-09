import { SupportPage, supportMetadata } from "@/features/legal/server";

export function generateMetadata() {
  return supportMetadata("tr");
}

export default function SupportRoute() {
  return <SupportPage locale="tr" />;
}
