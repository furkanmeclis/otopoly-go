import type { Metadata } from "next";

import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";

export const metadata: Metadata = {
  title: "Ücretsiz işletme hesabı oluştur",
  description:
    "Otopoly'de oto yıkama veya detailing işletmenizi 3 adımda kaydedin: işletme bilgileri, hizmetler ve hesap. 14 gün ücretsiz, kredi kartı gerekmez.",
  alternates: { canonical: "/register" },
};

export default function RegisterPage() {
  return <OnboardingWizard />;
}
