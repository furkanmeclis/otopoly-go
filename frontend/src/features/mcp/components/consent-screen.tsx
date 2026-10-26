"use client";

import {
  Building2,
  Eye,
  Loader2,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppWordmark } from "@/components/brand";
import { LocaleSwitch } from "@/components/layout/locale-switch";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/config/routes";
import { useMcpConsent, useMcpDecide } from "@/features/mcp/hooks/use-mcp";
import type { McpConsent, McpScope } from "@/features/mcp/services/mcp.service";
import { isApiError } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { appToast } from "@/providers/toast-provider";

function ConsentShell({ children }: { children: ReactNode }) {
  return (
    <div className="from-background via-muted/70 to-accent/25 relative flex min-h-svh flex-col items-center justify-center bg-gradient-to-br p-6 md:p-10">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LocaleSwitch />
        <ThemeSwitch />
      </div>
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="self-center">
          <AppWordmark />
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * OAuth consent of an MCP client (`/oauth/consent?request=<uuid>`): the
 * signed-in user reviews the client, the endpoint and the requested access,
 * picks the business the connection is bound to and approves or denies. The
 * browser then goes back to the client with a code or `access_denied`.
 */
export function ConsentScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request") ?? "";
  const { bootstrapped, isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (bootstrapped && !isAuthenticated) {
      const next = `${pathname}?${searchParams.toString()}`;
      router.replace(routes.public.loginWithNext(next));
    }
  }, [bootstrapped, isAuthenticated, pathname, router, searchParams]);

  const consent = useMcpConsent(
    requestId,
    bootstrapped && isAuthenticated && requestId !== "",
  );

  if (!requestId) {
    return (
      <ConsentShell>
        <InvalidRequest />
      </ConsentShell>
    );
  }

  if (!bootstrapped || !isAuthenticated || consent.isLoading) {
    return (
      <ConsentShell>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      </ConsentShell>
    );
  }

  if (consent.isError || !consent.data) {
    return (
      <ConsentShell>
        <InvalidRequest />
      </ConsentShell>
    );
  }

  return (
    <ConsentShell>
      <ConsentCard
        key={consent.data.request_uuid}
        consent={consent.data}
        email={user?.email ?? ""}
      />
    </ConsentShell>
  );
}

function InvalidRequest() {
  const { t } = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="text-destructive size-5" aria-hidden />
          {t("mcp.consent.invalid_title")}
        </CardTitle>
        <CardDescription>
          {t("mcp.consent.invalid_description")}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function ConsentCard({
  consent,
  email,
}: {
  consent: McpConsent;
  email: string;
}) {
  const { t } = useLocale();
  const decide = useMcpDecide(consent.request_uuid);
  const isPlatform = consent.realm === "platform";
  const writeRequested = consent.scopes.includes("mcp:write");
  const [orgUuid, setOrgUuid] = useState<string>(
    consent.organizations.length === 1
      ? (consent.organizations[0]?.uuid ?? "")
      : "",
  );
  const [allowWrite, setAllowWrite] = useState(writeRequested);
  const [leaving, setLeaving] = useState(false);

  const selectedOrg = useMemo(
    () => consent.organizations.find((o) => o.uuid === orgUuid),
    [consent.organizations, orgUuid],
  );
  const canApprove =
    consent.allowed && (isPlatform || Boolean(selectedOrg)) && !leaving;

  async function submit(decision: "approve" | "deny") {
    const scopes: McpScope[] =
      allowWrite && writeRequested ? ["mcp:read", "mcp:write"] : ["mcp:read"];
    try {
      const out = await decide.mutateAsync({
        decision,
        organization_uuid:
          decision === "approve" && !isPlatform ? orgUuid : undefined,
        scopes: decision === "approve" ? scopes : undefined,
      });
      setLeaving(true);
      window.location.assign(out.redirect_url);
    } catch (error) {
      appToast.error(
        isApiError(error) && error.message
          ? error.message
          : t("common.error_generic"),
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {t("mcp.consent.title", { client: consent.client_name })}
        </CardTitle>
        <CardDescription>
          {t(
            isPlatform
              ? "mcp.consent.description_platform"
              : "mcp.consent.description_org",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <dl className="bg-muted/40 grid gap-2 rounded-lg border p-3">
          <Fact label={t("mcp.consent.redirect_host")}>
            <span className="font-mono text-xs break-all">
              {consent.redirect_host}
            </span>
          </Fact>
          <Fact label={t("mcp.consent.endpoint")}>
            <Badge variant="secondary">
              {t(isPlatform ? "mcp.realm.platform" : "mcp.realm.org")}
            </Badge>
          </Fact>
          <Fact label={t("mcp.consent.account")}>
            <span className="break-all">{email}</span>
          </Fact>
        </dl>

        {!isPlatform ? (
          <section className="space-y-2">
            <h3 className="font-medium">{t("mcp.consent.choose_org")}</h3>
            {consent.organizations.length === 0 ? (
              <Alert variant="destructive">
                <Building2 className="size-4" aria-hidden />
                <AlertTitle>{t("mcp.consent.no_org_title")}</AlertTitle>
                <AlertDescription>
                  {t("mcp.consent.no_org_description")}
                </AlertDescription>
              </Alert>
            ) : (
              <RadioGroup
                value={orgUuid}
                onValueChange={setOrgUuid}
                aria-label={t("mcp.consent.choose_org")}
              >
                {consent.organizations.map((org) => (
                  <Label
                    key={org.uuid}
                    htmlFor={`org-${org.uuid}`}
                    className="hover:bg-muted/50 has-[[data-state=checked]]:border-primary flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal"
                  >
                    <RadioGroupItem value={org.uuid} id={`org-${org.uuid}`} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">{org.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {t(
                          org.role === "owner"
                            ? "mcp.consent.role_owner"
                            : "mcp.consent.role_staff",
                        )}
                        {org.tool_count != null
                          ? ` · ${t("mcp.consent.tool_count", { count: org.tool_count })}`
                          : ""}
                      </span>
                    </div>
                  </Label>
                ))}
              </RadioGroup>
            )}
          </section>
        ) : !consent.allowed ? (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" aria-hidden />
            <AlertTitle>{t("mcp.consent.no_platform_title")}</AlertTitle>
            <AlertDescription>
              {t("mcp.consent.no_platform_description")}
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="space-y-2">
          <h3 className="font-medium">{t("mcp.consent.access_title")}</h3>
          <ul className="space-y-2">
            <li className="flex items-start gap-3 rounded-lg border p-3">
              <Eye
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
                aria-hidden
              />
              <div className="space-y-0.5">
                <p className="font-medium">{t("mcp.scopes.read")}</p>
                <p className="text-muted-foreground text-xs">
                  {t(
                    isPlatform
                      ? "mcp.scopes.read_hint_platform"
                      : "mcp.scopes.read_hint_org",
                  )}
                  {isPlatform && consent.platform_tool_count != null
                    ? ` ${t("mcp.consent.tool_count", { count: consent.platform_tool_count })}`
                    : ""}
                </p>
              </div>
            </li>
            {writeRequested ? (
              <li className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="mcp-allow-write"
                  checked={allowWrite}
                  onCheckedChange={(v) => setAllowWrite(v === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="mcp-allow-write"
                  className="flex cursor-pointer flex-col items-start gap-0.5 font-normal"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <PencilLine className="size-3.5" aria-hidden />
                    {t("mcp.scopes.write")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("mcp.scopes.write_hint")}
                  </span>
                </Label>
              </li>
            ) : null}
          </ul>
        </section>

        <Separator />
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t("mcp.consent.footer")}
        </p>
      </CardContent>
      <CardFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={decide.isPending || leaving}
          onClick={() => void submit("deny")}
        >
          {t("mcp.consent.deny")}
        </Button>
        <Button
          type="button"
          disabled={!canApprove || decide.isPending}
          onClick={() => void submit("approve")}
        >
          {decide.isPending || leaving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {t("mcp.consent.approve")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
