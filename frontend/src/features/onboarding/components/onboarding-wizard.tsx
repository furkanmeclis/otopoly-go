"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  LogOut,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";

import { AppWordmark } from "@/components/brand";
import { AppForm } from "@/components/forms";
import { LocaleSwitch } from "@/components/layout/locale-switch";
import { ThemeSwitch } from "@/components/layout/theme-switch";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { routes } from "@/config/routes";
import {
  createOrganizationRegisterSchema,
  createOwnedBusinessSchema,
  type OrganizationRegisterFormValues,
} from "@/features/auth/schemas";
import { catalogService } from "@/features/catalog/services/catalog.service";
import {
  STARTER_SERVICES,
  type StarterService,
} from "@/features/onboarding/data/starter-services";
import {
  AccountStep,
  BusinessStep,
  ServicesStep,
} from "@/features/onboarding/components/onboarding-steps";
import {
  classifyCreateBusinessError,
  createBusinessErrorKey,
  createBusinessPayload,
  pickOwnedOrganization,
} from "@/features/onboarding/lib/create-business";
import { starterServicePayloads } from "@/features/onboarding/lib/prices";
import { organizationsService } from "@/features/organizations/services/organizations.service";
import { isApiError } from "@/lib/api";
import {
  CREDENTIAL_ERROR_CODES,
  resolveCredentialErrorCode,
} from "@/lib/auth/credentials-errors";
import { needsBusinessOnboarding } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { authService } from "@/services/auth.service";

type Values = OrganizationRegisterFormValues;

/**
 * - `register`: public sign-up (/register) — business, services, account.
 * - `create`: signed-in user without a business (/onboarding/business) —
 *   business, services; the account already exists.
 */
export type OnboardingMode = "register" | "create";

const ALL_STEPS = [
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

type Step = (typeof ALL_STEPS)[number];

function stepsFor(mode: OnboardingMode): readonly Step[] {
  return mode === "create"
    ? ALL_STEPS.filter((s) => s.key !== "account")
    : ALL_STEPS;
}

type Task =
  "register" | "signin" | "create" | "switch" | "services" | "redirect";
type TaskState = "pending" | "running" | "done" | "skipped";
type Tasks = Partial<Record<Task, TaskState>>;

const TASK_ORDER: Task[] = [
  "register",
  "signin",
  "create",
  "switch",
  "services",
  "redirect",
];

const EMPTY_VALUES: Values = {
  organization_name: "",
  phone: "",
  city: "",
  district: "",
  address: "",
  name: "",
  surname: "",
  email: "",
  password: "",
};

export function OnboardingWizard({
  mode = "register",
}: {
  mode?: OnboardingMode;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { update: updateSession } = useSession();
  const { markAuthenticated, hydrateProfile, logout, bootstrapped, user } =
    useAuth();
  const schema = useMemo(
    () =>
      mode === "create"
        ? createOwnedBusinessSchema(t)
        : createOrganizationRegisterSchema(t),
    [mode, t],
  );
  const steps = stepsFor(mode);

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [services, setServices] = useState<StarterService[]>(() =>
    STARTER_SERVICES.map((s) => ({ ...s })),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Tasks | null>(null);
  const [registrationClosed, setRegistrationClosed] = useState(false);

  // A signed-in user without a business who opens the public wizard would get
  // 409 "email already registered": send them to the create-business flow.
  // Decided once, so the account created by this wizard never triggers it.
  const checkedRef = useRef(false);
  useEffect(() => {
    if (mode !== "register" || checkedRef.current || !bootstrapped) return;
    checkedRef.current = true;
    if (needsBusinessOnboarding(user)) {
      router.replace(routes.onboarding.business);
    }
  }, [bootstrapped, mode, router, user]);

  const selectedServices = services.filter((s) => s.selected && s.name.trim());

  const setTask = (task: Task, state: TaskState) =>
    setTasks((prev) => (prev ? { ...prev, [task]: state } : prev));

  const createStarterServices = async () => {
    const payloads = starterServicePayloads(services);
    if (!payloads.length) return;
    setTask("services", "running");
    // Best effort: the business exists already; missing services can be added later.
    await Promise.allSettled(
      payloads.map((body) => catalogService.createService(body)),
    );
    setTask("services", "done");
  };

  /**
   * Same switch the tenant shell does (TenantOrganizationContext): the BFF
   * stores the org-scoped token pair in the session cookie, then the NextAuth
   * session and the /me profile are refreshed.
   */
  const enterOrganization = async (slug: string) => {
    await authService.switchOrganizationContext(slug);
    await updateSession();
    await hydrateProfile();
  };

  const onRegister = async (values: Values) => {
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

    await createStarterServices();

    setTask("redirect", "running");
    router.replace(`${routes.tenant.home(slug)}?welcome=1`);
  };

  const onCreate = async (values: Values) => {
    setFormError(null);
    setTasks({
      create: "running",
      switch: "pending",
      services: selectedServices.length ? "pending" : "skipped",
      redirect: "pending",
    });

    let slug: string;
    let created = true;
    try {
      const result = await organizationsService.createOwned(
        createBusinessPayload(values),
      );
      slug = result.organization.slug;
    } catch (error) {
      const failure = classifyCreateBusinessError(error);
      if (failure === "registration_closed") {
        setTasks(null);
        setRegistrationClosed(true);
        return;
      }
      const owned =
        failure === "already_owner"
          ? pickOwnedOrganization((await hydrateProfile())?.organizations ?? [])
          : null;
      if (!owned) {
        setTasks(null);
        if (failure === "validation") {
          setDirection(-1);
          setStep(0);
        }
        setFormError(t(createBusinessErrorKey(failure)));
        return;
      }
      // 409: the user already owns a business (e.g. created in another tab).
      slug = owned.slug;
      created = false;
    }
    setTask("create", "done");
    setTask("switch", "running");

    let switched = true;
    try {
      await enterOrganization(slug);
    } catch {
      // The tenant shell retries the switch on arrival.
      switched = false;
    }
    setTask("switch", "done");

    // Tenant catalog writes need the org-scoped token.
    if (created && switched) {
      await createStarterServices();
    } else {
      setTask("services", "skipped");
    }

    setTask("redirect", "running");
    router.replace(
      created
        ? `${routes.tenant.home(slug)}?welcome=1`
        : routes.tenant.home(slug),
    );
  };

  const signOutAndLeave = async () => {
    await logout();
    router.replace(routes.public.root);
  };

  const stepMeta = steps[step] ?? ALL_STEPS[0];
  const isLastStep = step === steps.length - 1;

  return (
    <div className="bg-background grid min-h-svh lg:grid-cols-[minmax(0,26rem)_1fr]">
      <OnboardingAside
        mode={mode}
        steps={steps}
        step={step}
        working={Boolean(tasks)}
      />

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
          {registrationClosed ? (
            <RegistrationClosedPanel onSignOut={signOutAndLeave} />
          ) : tasks ? (
            <ProgressPanel mode={mode} tasks={tasks} />
          ) : (
            <AppForm<Values>
              schema={schema}
              defaultValues={EMPTY_VALUES}
              onSubmit={mode === "create" ? onCreate : onRegister}
            >
              {(form) => {
                const goNext = async () => {
                  // trigger([]) would validate the whole form (incl. later steps).
                  if (stepMeta.fields.length > 0) {
                    const ok = await form.trigger([...stepMeta.fields]);
                    if (!ok) return;
                  }
                  setDirection(1);
                  setStep((s) => Math.min(s + 1, steps.length - 1));
                };
                const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                  const target = event.target as HTMLElement;
                  if (
                    event.key === "Enter" &&
                    !isLastStep &&
                    target.tagName === "INPUT"
                  ) {
                    event.preventDefault();
                    void goNext();
                  }
                };
                return (
                  <div onKeyDown={onKeyDown}>
                    <div className="mb-6 flex gap-1.5 lg:hidden" aria-hidden>
                      {steps.map((item, index) => (
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
                        total: steps.length,
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
                      ) : mode === "create" ? (
                        <span className="text-muted-foreground min-w-0 text-sm">
                          {user?.email ? (
                            <span className="block truncate">
                              {t("register.create.signed_in_as", {
                                email: user.email,
                              })}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void signOutAndLeave()}
                            className="text-primary font-medium hover:underline"
                          >
                            {t("register.create.sign_out")}
                          </button>
                        </span>
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
                      {!isLastStep ? (
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
                          {mode === "create"
                            ? t("register.create.finish")
                            : t("register.onboarding.finish")}
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
  mode,
  steps,
  step,
  working,
}: {
  mode: OnboardingMode;
  steps: readonly Step[];
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
          {mode === "create"
            ? t("register.create.aside_title")
            : t("register.onboarding.aside_title")}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          {t("register.onboarding.aside_description")}
        </p>
      </div>
      <ol className="mt-10 space-y-1">
        {steps.map((item, index) => {
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

function ProgressPanel({
  mode,
  tasks,
}: {
  mode: OnboardingMode;
  tasks: Tasks;
}) {
  const { t } = useLocale();
  return (
    <div className="text-center">
      <span className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
        <Loader2 className="size-6 animate-spin" />
      </span>
      <h1 className="font-display mt-6 text-2xl font-semibold tracking-tight">
        {mode === "create"
          ? t("register.create.working_title")
          : t("register.onboarding.working.title")}
      </h1>
      <ul className="mx-auto mt-8 max-w-xs space-y-3 text-left">
        {TASK_ORDER.map((task) => {
          const state = tasks[task];
          if (!state || state === "skipped") return null;
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

function RegistrationClosedPanel({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  return (
    <div className="text-center">
      <span className="bg-muted text-muted-foreground mx-auto grid size-14 place-items-center rounded-2xl">
        <Building2 className="size-6" />
      </span>
      <h1 className="font-display mt-6 text-2xl font-semibold tracking-tight">
        {t("register.create.closed_title")}
      </h1>
      <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-sm leading-relaxed">
        {t("register.create.closed_description")}
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-8"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onSignOut();
        }}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )}
        {t("register.create.sign_out")}
      </Button>
    </div>
  );
}
