"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";

import { AppWordmark } from "@/components/brand";
import {
  AppCombobox,
  AppForm,
  AppInput,
  AppPassword,
  AppTextarea,
} from "@/components/forms";
import { LocaleSwitch } from "@/components/layout/locale-switch";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { routes } from "@/config/routes";
import {
  createOrganizationRegisterSchema,
  type OrganizationRegisterFormValues,
} from "@/features/auth/schemas";
import { catalogService } from "@/features/catalog/services/catalog.service";
import { TR_PROVINCES } from "@/features/onboarding/data/provinces";
import {
  STARTER_SERVICES,
  type StarterService,
} from "@/features/onboarding/data/starter-services";
import { organizationsService } from "@/features/organizations/services/organizations.service";
import { isApiError } from "@/lib/api";
import {
  CREDENTIAL_ERROR_CODES,
  resolveCredentialErrorCode,
} from "@/lib/auth/credentials-errors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";

type Values = OrganizationRegisterFormValues;

const STEPS = [
  {
    key: "business",
    icon: Building2,
    fields: ["organization_name", "phone", "city", "district", "address"],
  },
  { key: "services", icon: Wrench, fields: [] },
  {
    key: "account",
    icon: UserRound,
    fields: ["name", "surname", "email", "password"],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  icon: unknown;
  fields: ReadonlyArray<keyof Values>;
}>;

type Task = "register" | "signin" | "services" | "redirect";
type TaskState = "pending" | "running" | "done" | "skipped";

const PROVINCE_OPTIONS = TR_PROVINCES.map((name) => ({
  value: name,
  label: name,
}));

/** "1.400" / "1400,50" → "1400.50" (API decimal). */
function normalizePrice(raw: string): string {
  const cleaned = raw.replace(/[^\d,.]/g, "");
  const lastSep = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  if (lastSep === -1) return cleaned;
  const decimals = cleaned.slice(lastSep + 1);
  // A 3-digit tail after the only separator is a thousands separator.
  if (decimals.length === 3) return cleaned.replace(/[.,]/g, "");
  return `${cleaned.slice(0, lastSep).replace(/[.,]/g, "")}.${decimals}`;
}

export function OnboardingWizard() {
  const { t } = useLocale();
  const router = useRouter();
  const { markAuthenticated, hydrateProfile } = useAuth();
  const schema = useMemo(() => createOrganizationRegisterSchema(t), [t]);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [services, setServices] = useState<StarterService[]>(() =>
    STARTER_SERVICES.map((s) => ({ ...s })),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<Task, TaskState> | null>(null);

  const selectedServices = services.filter((s) => s.selected && s.name.trim());

  const setTask = (task: Task, state: TaskState) =>
    setTasks((prev) => (prev ? { ...prev, [task]: state } : prev));

  const onSubmit = async (values: Values) => {
    setFormError(null);
    setTasks({
      register: "running",
      signin: "pending",
      services: selectedServices.length ? "pending" : "skipped",
      redirect: "pending",
    });
    let slug: string;
    try {
      const result = await organizationsService.register({ ...values });
      slug = result.organization.slug;
    } catch (error) {
      setTasks(null);
      setFormError(
        isApiError(error)
          ? error.message || t("register.error")
          : t("register.error"),
      );
      return;
    }
    setTask("register", "done");
    setTask("signin", "running");

    const signInResult = await signIn("credentials", {
      email: values.email,
      password: values.password,
      organization_slug: slug,
      redirect: false,
    });
    if (signInResult?.error) {
      const code = resolveCredentialErrorCode(signInResult);
      setTasks(null);
      setFormError(
        code === CREDENTIAL_ERROR_CODES.NO_TENANT_MEMBERSHIP
          ? t("auth.login.no_tenant_membership")
          : code === CREDENTIAL_ERROR_CODES.ORGANIZATION_ACCESS_EXPIRED
            ? t("organizations.access.expired_title")
            : t("register.error_sign_in"),
      );
      return;
    }
    markAuthenticated();
    await hydrateProfile();
    setTask("signin", "done");

    if (selectedServices.length) {
      setTask("services", "running");
      // Best effort: the account exists already; missing services can be added later.
      await Promise.allSettled(
        selectedServices.map((service) =>
          catalogService.createService({
            name: service.name.trim(),
            price: normalizePrice(service.price) || "0",
            currency: "TRY",
            is_active: true,
          }),
        ),
      );
      setTask("services", "done");
    }

    setTask("redirect", "running");
    router.replace(`${routes.tenant.home(slug)}?welcome=1`);
  };

  const stepMeta = STEPS[step];

  return (
    <div className="bg-background grid min-h-svh lg:grid-cols-[minmax(0,26rem)_1fr]">
      <OnboardingAside step={step} working={Boolean(tasks)} />

      <main className="relative flex flex-col">
        <div className="flex items-center justify-between gap-2 px-4 pt-4 sm:px-8">
          <Link
            href={routes.public.root}
            className="lg:invisible"
            aria-label={t("common.app_product")}
          >
            <AppWordmark className="h-6" />
          </Link>
          <div className="flex items-center gap-1">
            <LocaleSwitch />
            <ThemeSwitch />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8 sm:px-8">
          {tasks ? (
            <ProgressPanel tasks={tasks} />
          ) : (
            <AppForm<Values>
              schema={schema}
              defaultValues={{
                organization_name: "",
                phone: "",
                city: "",
                district: "",
                address: "",
                name: "",
                surname: "",
                email: "",
                password: "",
              }}
              onSubmit={onSubmit}
            >
              {(form) => {
                const goNext = async () => {
                  // trigger([]) would validate the whole form (incl. later steps).
                  if (stepMeta.fields.length > 0) {
                    const ok = await form.trigger([...stepMeta.fields]);
                    if (!ok) return;
                  }
                  setDirection(1);
                  setStep((s) => Math.min(s + 1, STEPS.length - 1));
                };
                const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                  const target = event.target as HTMLElement;
                  if (
                    event.key === "Enter" &&
                    step < STEPS.length - 1 &&
                    target.tagName === "INPUT"
                  ) {
                    event.preventDefault();
                    void goNext();
                  }
                };
                return (
                  <div onKeyDown={onKeyDown}>
                    <div className="mb-6 flex gap-1.5 lg:hidden" aria-hidden>
                      {STEPS.map((item, index) => (
                        <span
                          key={item.key}
                          className={cn(
                            "h-1.5 flex-1 rounded-full transition-colors",
                            index <= step ? "bg-primary" : "bg-muted",
                          )}
                        />
                      ))}
                    </div>
                    <p className="text-primary text-xs font-semibold tracking-wide uppercase">
                      {t("register.onboarding.step_of", {
                        current: step + 1,
                        total: STEPS.length,
                      })}
                    </p>
                    <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                      {t(`register.onboarding.${stepMeta.key}.title`)}
                    </h1>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {t(`register.onboarding.${stepMeta.key}.description`)}
                    </p>

                    {formError ? (
                      <FieldError className="mt-4">{formError}</FieldError>
                    ) : null}

                    <div className="relative mt-6">
                      <AnimatePresence
                        mode="wait"
                        custom={direction}
                        initial={false}
                      >
                        <motion.div
                          key={stepMeta.key}
                          custom={direction}
                          initial={{ opacity: 0, x: direction * 24 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: direction * -24 }}
                          transition={{ duration: 0.22, ease: "easeOut" }}
                        >
                          {stepMeta.key === "business" ? (
                            <BusinessStep />
                          ) : null}
                          {stepMeta.key === "services" ? (
                            <ServicesStep
                              services={services}
                              onChange={setServices}
                            />
                          ) : null}
                          {stepMeta.key === "account" ? <AccountStep /> : null}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    <div className="mt-8 flex items-center justify-between gap-3">
                      {step > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setDirection(-1);
                            setStep((s) => Math.max(s - 1, 0));
                          }}
                        >
                          <ArrowLeft className="size-4" />
                          {t("register.onboarding.back")}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {t("register.onboarding.have_account")}{" "}
                          <Link
                            href="/login"
                            className="text-primary font-medium hover:underline"
                          >
                            {t("register.onboarding.sign_in")}
                          </Link>
                        </span>
                      )}
                      {step < STEPS.length - 1 ? (
                        <Button
                          key="next"
                          type="button"
                          onClick={() => void goNext()}
                          className="min-w-32"
                        >
                          {stepMeta.key === "services" &&
                          selectedServices.length === 0
                            ? t("register.onboarding.skip")
                            : t("register.onboarding.next")}
                          <ArrowRight className="size-4" />
                        </Button>
                      ) : (
                        // Distinct key: reusing the "next" <button> node would turn the
                        // click that reached this step into a form submit.
                        <Button
                          key="submit"
                          type="submit"
                          className="min-w-40"
                          disabled={form.formState.isSubmitting}
                        >
                          <Sparkles className="size-4" />
                          {t("register.onboarding.finish")}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              }}
            </AppForm>
          )}
        </div>
      </main>
    </div>
  );
}

function OnboardingAside({
  step,
  working,
}: {
  step: number;
  working: boolean;
}) {
  const { t } = useLocale();
  return (
    <aside
      className="relative isolate hidden overflow-hidden bg-[#1A1412] p-10 text-white lg:flex lg:flex-col"
      style={{ "--brand-glyph": "#fff" } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(120%_70%_at_100%_0%,rgba(234,110,67,0.55),transparent_60%),radial-gradient(90%_60%_at_0%_100%,rgba(242,176,143,0.18),transparent_60%)]"
      />
      <Link href={routes.public.root} aria-label={t("common.app_product")}>
        <AppWordmark className="h-7" />
      </Link>
      <div className="mt-16">
        <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight">
          {t("register.onboarding.aside_title")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          {t("register.onboarding.aside_description")}
        </p>
      </div>
      <ol className="mt-10 space-y-1">
        {STEPS.map((item, index) => {
          const done = working || index < step;
          const active = !working && index === step;
          const Icon = item.icon;
          return (
            <li
              key={item.key}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
                active && "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg border transition-colors",
                  done
                    ? "border-transparent bg-[#EA6E43] text-white"
                    : active
                      ? "border-white/40 text-white"
                      : "border-white/15 text-white/50",
                )}
              >
                {done ? (
                  <Check className="size-4" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <div className={cn(!active && !done && "text-white/55")}>
                <p className="text-sm font-medium">
                  {t(`register.onboarding.${item.key}.nav`)}
                </p>
                <p className="text-xs text-white/55">
                  {t(`register.onboarding.${item.key}.nav_hint`)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <ul className="mt-auto space-y-2 pt-10 text-sm text-white/70">
        {(["trial", "no_card", "cancel"] as const).map((key) => (
          <li key={key} className="flex items-center gap-2">
            <Check className="size-4 text-[#F59A6F]" />
            {t(`register.onboarding.perks.${key}`)}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function BusinessStep() {
  const { t } = useLocale();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AppInput
        name="organization_name"
        label={t("register.fields.organization_name")}
        placeholder={t("register.onboarding.business.name_placeholder")}
        autoFocus
        className="sm:col-span-2"
      />
      <AppInput
        name="phone"
        type="tel"
        inputMode="tel"
        label={t("register.fields.phone")}
        placeholder="05XX XXX XX XX"
        className="sm:col-span-2"
      />
      <AppCombobox
        name="city"
        label={t("register.fields.city")}
        options={PROVINCE_OPTIONS}
        placeholder={t("register.onboarding.business.city_placeholder")}
        searchPlaceholder={t("register.onboarding.business.city_search")}
        emptyText={t("register.onboarding.business.city_empty")}
      />
      <AppInput
        name="district"
        label={t("register.fields.district")}
        placeholder={t("register.onboarding.business.district_placeholder")}
      />
      <AppTextarea
        name="address"
        label={t("register.fields.address")}
        rows={2}
        className="sm:col-span-2"
      />
    </div>
  );
}

function ServicesStep({
  services,
  onChange,
}: {
  services: StarterService[];
  onChange: (next: StarterService[]) => void;
}) {
  const { t } = useLocale();
  const update = (key: string, patch: Partial<StarterService>) =>
    onChange(services.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  return (
    <div>
      <ul className="divide-y rounded-2xl border">
        {services.map((service) => (
          <li
            key={service.key}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 transition-colors",
              service.selected ? "bg-primary/5" : "",
            )}
          >
            <Checkbox
              id={`svc-${service.key}`}
              checked={service.selected}
              onCheckedChange={(checked) =>
                update(service.key, { selected: checked === true })
              }
            />
            <label
              htmlFor={`svc-${service.key}`}
              className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
            >
              {service.name}
            </label>
            <div className="relative w-28">
              <Input
                value={service.price}
                inputMode="decimal"
                disabled={!service.selected}
                onChange={(e) => update(service.key, { price: e.target.value })}
                className="h-8 pr-7 text-right tabular-nums"
                aria-label={`${service.name} · ${t("register.onboarding.services.price")}`}
              />
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                ₺
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs">
        {t("register.onboarding.services.hint")}
      </p>
    </div>
  );
}

const PASSWORD_RULES = [
  { key: "min", test: (v: string) => v.length >= 8 },
  { key: "upper", test: (v: string) => /[A-Z]/.test(v) },
  { key: "lower", test: (v: string) => /[a-z]/.test(v) },
  { key: "digit", test: (v: string) => /[0-9]/.test(v) },
] as const;

function AccountStep() {
  const { t } = useLocale();
  const { control } = useFormContext<Values>();
  const password = useWatch({ control, name: "password" }) ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AppInput
        name="name"
        label={t("register.fields.name")}
        autoComplete="given-name"
        autoFocus
      />
      <AppInput
        name="surname"
        label={t("register.fields.surname")}
        autoComplete="family-name"
      />
      <AppInput
        name="email"
        type="email"
        label={t("register.fields.email")}
        autoComplete="email"
        className="sm:col-span-2"
      />
      <div className="sm:col-span-2">
        <AppPassword
          name="password"
          label={t("register.fields.password")}
          autoComplete="new-password"
        />
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {PASSWORD_RULES.map((rule) => {
            const ok = rule.test(password);
            return (
              <li
                key={rule.key}
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground",
                )}
              >
                <Check className={cn("size-3.5", !ok && "opacity-30")} />
                {t(`register.onboarding.password.${rule.key}`)}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const TASK_ORDER: Task[] = ["register", "signin", "services", "redirect"];

function ProgressPanel({ tasks }: { tasks: Record<Task, TaskState> }) {
  const { t } = useLocale();
  return (
    <div className="text-center">
      <span className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
        <Loader2 className="size-6 animate-spin" />
      </span>
      <h1 className="font-display mt-6 text-2xl font-semibold tracking-tight">
        {t("register.onboarding.working.title")}
      </h1>
      <ul className="mx-auto mt-8 max-w-xs space-y-3 text-left">
        {TASK_ORDER.filter((task) => tasks[task] !== "skipped").map((task) => {
          const state = tasks[task];
          return (
            <li key={task} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border",
                  state === "done" &&
                    "border-transparent bg-emerald-500 text-white",
                  state === "running" && "border-primary text-primary",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3.5" />
                ) : state === "running" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
              </span>
              <span
                className={cn(state === "pending" && "text-muted-foreground")}
              >
                {t(`register.onboarding.working.${task}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
