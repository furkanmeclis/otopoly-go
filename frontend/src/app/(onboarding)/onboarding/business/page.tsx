import type { Metadata } from "next";

import { CreateBusinessGate } from "@/features/onboarding/components/create-business-gate";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "İşletmeni oluştur",
  robots: { index: false, follow: false },
};

/** Signed-in user without a business creates one (account step skipped). */
export default function CreateBusinessPage() {
  return (
    <CreateBusinessGate>
      <OnboardingWizard mode="create" />
    </CreateBusinessGate>
  );
}
