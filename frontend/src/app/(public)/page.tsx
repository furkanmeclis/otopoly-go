"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { brand } from "@/config/brand";
import { useLocale } from "@/providers/locale-provider";

export default function PublicHomePage() {
  const { t } = useLocale();

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {brand.productName}
          </h1>
          <p className="text-muted-foreground text-sm">{brand.tagline}</p>
        </div>
        <p className="text-muted-foreground text-sm">
          {t("register.landing_description")}
        </p>
        <Button asChild size="lg">
          <Link href={routes.public.register}>{t("register.landing_cta")}</Link>
        </Button>
      </div>
    </div>
  );
}
