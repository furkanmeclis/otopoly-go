import type { Metadata } from "next";

import { PublicReviewPage } from "@/features/reviews";

export const metadata: Metadata = {
  title: "Değerlendirme",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  return <PublicReviewPage token={token} />;
}
