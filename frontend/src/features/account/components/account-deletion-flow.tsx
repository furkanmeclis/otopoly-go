"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AppLocale } from "@/config/i18n";
import { routes } from "@/config/routes";
import { isApiError } from "@/lib/api";
import { translate } from "@/lib/i18n/messages";
import {
  authService,
  type AccountDeletionScheduled,
} from "@/services/auth.service";

type Mode = "delete" | "recover";
type Step = "email" | "code" | "done";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

/** "2026-12-09" (Europe/Istanbul day from the API) → localized date, no TZ shift. */
function formatDay(day: string, locale: AppLocale): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

type FlowProps = { locale: AppLocale };

/** Public account deletion + recovery (email code), used by /account/delete. */
export function AccountDeletionFlow({ locale }: FlowProps) {
  const t = (key: string, params?: Record<string, string>) =>
    translate(locale, `auth.account_deletion.${key}`, params, locale);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const mode: Mode =
    searchParams.get("mode") === "recover" ? "recover" : "delete";

  const setMode = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "recover") params.set("mode", "recover");
    else params.delete("mode");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <Tabs value={mode} onValueChange={setMode} className="mt-8">
      <TabsList className="w-full">
        <TabsTrigger value="delete">{t("tab_delete")}</TabsTrigger>
        <TabsTrigger value="recover">{t("tab_recover")}</TabsTrigger>
      </TabsList>
      <TabsContent value="delete" className="mt-6">
        <DeleteFlow locale={locale} t={t} />
      </TabsContent>
      <TabsContent value="recover" className="mt-6">
        <RecoverFlow locale={locale} t={t} />
      </TabsContent>
    </Tabs>
  );
}

type Translator = (key: string, params?: Record<string, string>) => string;

function errorMessage(error: unknown, t: Translator, locale: AppLocale) {
  if (isApiError(error)) {
    switch (error.code) {
      case "INVALID_EMAIL_CODE":
        return translate(locale, "auth.email_code.invalid", undefined, locale);
      case "RATE_LIMITED":
        return translate(locale, "auth.login.rate_limited", undefined, locale);
      case "INVALID_MFA_CODE":
        return translate(locale, "auth.totp.login_invalid", undefined, locale);
      case "CONFLICT":
        return t("error_last_admin");
      case "VALIDATION_ERROR":
        return t("error_email");
    }
  }
  return t("error_generic");
}

function EmailStep({
  t,
  email,
  setEmail,
  busy,
  submitLabel,
  onSubmit,
}: {
  t: Translator;
  email: string;
  setEmail: (value: string) => void;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="account-deletion-email">{t("email_label")}</Label>
        <Input
          id="account-deletion-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder={t("email_placeholder")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t("sending") : submitLabel}
      </Button>
    </form>
  );
}

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <ShieldAlert aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function DeleteFlow({ locale, t }: { locale: AppLocale; t: Translator }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountDeletionScheduled | null>(null);

  const sendCode = async () => {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError(t("error_email"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authService.requestAccountDeletion(value);
      setEmail(value);
      setStep("code");
    } catch (err) {
      setError(errorMessage(err, t, locale));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    const cleanCode = code.replace(/\s/g, "");
    if (!CODE_RE.test(cleanCode)) {
      setError(t("error_code"));
      return;
    }
    if (needsTotp && !totp.trim()) {
      setError(t("error_totp"));
      return;
    }
    if (!acknowledged) {
      setError(t("error_acknowledge"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scheduled = await authService.confirmAccountDeletion({
        email,
        code: cleanCode,
        ...(needsTotp ? { totp_code: totp.trim() } : {}),
      });
      setResult(scheduled);
      setStep("done");
    } catch (err) {
      if (isApiError(err) && err.code === "MFA_REQUIRED") {
        setNeedsTotp(true);
        setError(t("totp_hint"));
      } else {
        setError(errorMessage(err, t, locale));
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("email");
    setCode("");
    setTotp("");
    setNeedsTotp(false);
    setAcknowledged(false);
    setError(null);
  };

  if (step === "done" && result) {
    const owned = result.owned_organizations ?? [];
    return (
      <Alert>
        <CheckCircle2 aria-hidden />
        <AlertTitle>{t("done_title")}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            {t("done_body", {
              date: formatDay(result.deletion_scheduled_on, locale),
            })}
          </p>
          {owned.length > 0 ? (
            <p>
              {t("done_owned", {
                names: owned.map((org) => org.name).join(", "),
              })}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (step === "email") {
    return (
      <div className="space-y-4">
        <ErrorAlert message={error} />
        <EmailStep
          t={t}
          email={email}
          setEmail={setEmail}
          busy={busy}
          submitLabel={t("send_code")}
          onSubmit={sendCode}
        />
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4" noValidate>
      <p className="text-muted-foreground text-sm">
        {t("code_sent", { email })}
      </p>
      <ErrorAlert message={error} />
      <div className="space-y-2">
        <Label htmlFor="account-deletion-code">{t("code_label")}</Label>
        <Input
          id="account-deletion-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </div>
      {needsTotp ? (
        <div className="space-y-2">
          <Label htmlFor="account-deletion-totp">{t("totp_label")}</Label>
          <Input
            id="account-deletion-totp"
            autoComplete="one-time-code"
            value={totp}
            onChange={(event) => setTotp(event.target.value)}
            required
          />
        </div>
      ) : null}
      <div className="flex items-start gap-3">
        <Checkbox
          id="account-deletion-ack"
          checked={acknowledged}
          onCheckedChange={(value) => setAcknowledged(value === true)}
          className="mt-0.5"
        />
        <Label
          htmlFor="account-deletion-ack"
          className="text-sm leading-snug font-normal"
        >
          {t("acknowledge")}
        </Label>
      </div>
      <Button
        type="submit"
        variant="destructive"
        className="w-full"
        disabled={busy}
      >
        {busy ? t("confirming") : t("confirm")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="link" className="px-0" onClick={reset}>
          {t("change_email")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={busy}
          onClick={() => void sendCode()}
        >
          {t("resend")}
        </Button>
      </div>
    </form>
  );
}

function RecoverFlow({ locale, t }: { locale: AppLocale; t: Translator }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError(t("error_email"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authService.requestAccountRecovery(value);
      setEmail(value);
      setStep("code");
    } catch (err) {
      setError(errorMessage(err, t, locale));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    const cleanCode = code.replace(/\s/g, "");
    if (!CODE_RE.test(cleanCode)) {
      setError(t("error_code"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authService.confirmAccountRecovery({ email, code: cleanCode });
      setStep("done");
    } catch (err) {
      setError(errorMessage(err, t, locale));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <Alert>
        <CheckCircle2 aria-hidden />
        <AlertTitle>{t("recovered_title")}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{t("recovered_body")}</p>
          <Button asChild size="sm">
            <Link href={routes.public.login}>{t("go_login")}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (step === "email") {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("recover_intro")}</p>
        <ErrorAlert message={error} />
        <EmailStep
          t={t}
          email={email}
          setEmail={setEmail}
          busy={busy}
          submitLabel={t("recover_send")}
          onSubmit={sendCode}
        />
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="space-y-4" noValidate>
      <p className="text-muted-foreground text-sm">
        {t("recover_code_sent", { email })}
      </p>
      <ErrorAlert message={error} />
      <div className="space-y-2">
        <Label htmlFor="account-recovery-code">{t("code_label")}</Label>
        <Input
          id="account-recovery-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? t("recovering") : t("recover_confirm")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="link"
          className="px-0"
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          {t("change_email")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="px-0"
          disabled={busy}
          onClick={() => void sendCode()}
        >
          {t("resend")}
        </Button>
      </div>
    </form>
  );
}
