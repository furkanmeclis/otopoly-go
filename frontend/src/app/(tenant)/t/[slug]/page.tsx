"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenant } from "@/features/organizations/providers/tenant-provider";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

export default function TenantHomePage() {
  const { t } = useLocale();
  const { organization } = useTenant();
  const { user } = useAuth();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {organization?.name ?? t("organizations.home.title")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("organizations.home.subtitle")}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("layout.page_ready")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {user?.fullName
            ? t("organizations.home.greeting", { name: user.fullName })
            : t("layout.page_ready_description")}
        </CardContent>
      </Card>
    </div>
  );
}
