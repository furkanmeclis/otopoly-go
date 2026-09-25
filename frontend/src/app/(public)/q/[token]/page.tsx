import type { Metadata } from "next";

import { PublicQuotePage } from "@/features/quotes";

export const metadata: Metadata = {
  title: "Teklif",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  return <PublicQuotePage token={token} />;
}
