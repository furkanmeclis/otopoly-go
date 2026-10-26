"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  HeartHandshake,
  Languages,
  Loader2,
  Phone,
  SearchX,
  Star,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiConfig } from "@/config/api";
import {
  publicReviewsService,
  PublicReviewError,
} from "@/features/reviews/services/reviews.service";
import type { PublicReview } from "@/features/reviews/types";
import { translate } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

type Lang = "tr" | "en";

const SCORE_KEYS = [
  "reviews.public.score_1",
  "reviews.public.score_2",
  "reviews.public.score_3",
  "reviews.public.score_4",
  "reviews.public.score_5",
] as const;

/**
 * Public review page (/r/{token}): mobile-first, no session. The language
 * follows the business default of the request and can be switched.
 */
export function PublicReviewPage({ token }: { token: string }) {
  const qc = useQueryClient();
  const key = ["public", "review", token];
  const query = useQuery({
    queryKey: key,
    queryFn: () => publicReviewsService.get(token),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [chosenLang, setChosenLang] = useState<Lang | null>(null);
  const lang: Lang = chosenLang ?? (query.data?.locale === "en" ? "en" : "tr");
  const t = (k: string, params?: Record<string, string | number>) =>
    translate(lang, k, params, "tr");

  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useMutation({
    mutationFn: () =>
      publicReviewsService.answer(token, { score, comment, consent }),
    onSuccess: (data) => qc.setQueryData(key, data),
    onError: (err) => {
      if (err instanceof PublicReviewError && err.code === "ALREADY_ANSWERED") {
        void query.refetch();
        return;
      }
      if (err instanceof PublicReviewError && err.code === "REVIEW_EXPIRED") {
        void query.refetch();
        return;
      }
      setError(t("reviews.public.error"));
    },
  });
  const google = useMutation({
    mutationFn: () => publicReviewsService.google(token),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const toggleLang = (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => setChosenLang(lang === "tr" ? "en" : "tr")}
    >
      <Languages className="size-4" />
      {lang === "tr" ? "English" : "Türkçe"}
    </Button>
  );

  if (query.isLoading) {
    return (
      <Shell>
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </Shell>
    );
  }
  if (!query.data) {
    return (
      <Shell footer={toggleLang}>
        <Message
          icon={<SearchX className="size-10" />}
          title={t("reviews.public.not_found")}
          body={t("reviews.public.not_found_hint")}
        />
      </Shell>
    );
  }
  const r: PublicReview = query.data;
  const logo = r.organization_logo_url
    ? `${apiConfig.baseUrl.replace(/\/$/, "")}${r.organization_logo_url}`
    : null;

  return (
    <Shell footer={toggleLang}>
      <header
        className="bg-card flex items-center gap-3 rounded-2xl border-t-4 p-4 shadow-xs"
        style={{ borderTopColor: r.primary_color }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            className="size-12 rounded-lg object-contain"
          />
        ) : (
          <span
            className="grid size-12 shrink-0 place-items-center rounded-lg text-lg font-bold text-white"
            style={{ background: r.primary_color }}
          >
            {r.organization_name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <p className="min-w-0 flex-1 truncate text-base font-semibold">
          {r.organization_name}
        </p>
      </header>

      {r.state === "expired" ? (
        <Message
          icon={<Clock3 className="size-10" />}
          title={t("reviews.public.expired")}
          body={t("reviews.public.expired_hint")}
          phone={r.organization_phone}
          callLabel={t("reviews.public.call")}
        />
      ) : r.state === "answered" ? (
        r.result === "high" ? (
          <section className="bg-card space-y-5 rounded-2xl border p-6 text-center">
            <Stars value={r.score ?? 5} readOnly />
            <div className="space-y-2">
              <h1 className="text-xl font-semibold">
                {t("reviews.public.thanks_title")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {r.google_review_url
                  ? t("reviews.public.thanks_google", {
                      business: r.organization_name,
                    })
                  : t("reviews.public.thanks_body")}
              </p>
            </div>
            {r.google_review_url ? (
              <Button
                size="lg"
                className="h-14 w-full text-base font-semibold"
                style={{ background: r.primary_color }}
                onClick={() => google.mutate()}
                disabled={google.isPending}
              >
                {google.isPending ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <GoogleMark />
                )}
                {t("reviews.public.google_button")}
              </Button>
            ) : null}
          </section>
        ) : (
          <Message
            icon={<HeartHandshake className="size-10" />}
            title={t("reviews.public.thanks_title")}
            body={t("reviews.public.thanks_low")}
            phone={r.organization_phone}
            callLabel={t("reviews.public.call")}
          />
        )
      ) : (
        <section className="bg-card space-y-6 rounded-2xl border p-5 sm:p-6">
          <div className="space-y-1 text-center">
            <p className="text-muted-foreground text-sm">
              {r.customer_first_name
                ? t("reviews.public.greeting", { name: r.customer_first_name })
                : t("reviews.public.greeting_anon")}
            </p>
            <h1 className="text-xl font-semibold text-balance">
              {t("reviews.public.question", { business: r.organization_name })}
            </h1>
          </div>
          <div className="space-y-2">
            <Stars
              value={score}
              onChange={(v) => {
                setScore(v);
                setError(null);
              }}
              labels={SCORE_KEYS.map((k) => t(k))}
            />
            <p className="text-muted-foreground h-5 text-center text-sm font-medium">
              {score ? t(SCORE_KEYS[score - 1]) : t("reviews.public.tap_star")}
            </p>
          </div>
          {score ? (
            <div className="space-y-2">
              <Label htmlFor="review-comment">
                {score >= 4
                  ? t("reviews.public.comment_high")
                  : t("reviews.public.comment_low")}
              </Label>
              <Textarea
                id="review-comment"
                rows={4}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("reviews.public.comment_placeholder")}
              />
            </div>
          ) : null}
          {score && r.consent_text ? (
            <div className="flex items-start gap-3">
              <Checkbox
                id="review-consent"
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="review-consent"
                className="text-muted-foreground text-xs leading-relaxed font-normal"
              >
                {r.consent_text}
              </Label>
            </div>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button
            size="lg"
            className="h-12 w-full text-base"
            style={score ? { background: r.primary_color } : undefined}
            disabled={!score || answer.isPending}
            onClick={() => answer.mutate()}
          >
            {answer.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : null}
            {t("reviews.public.submit")}
          </Button>
        </section>
      )}
    </Shell>
  );
}

function Shell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="bg-muted/30 min-h-dvh px-4 py-6 sm:py-12">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        {children}
        {footer ? <div className="flex justify-center">{footer}</div> : null}
      </div>
    </main>
  );
}

function Message({
  icon,
  title,
  body,
  phone,
  callLabel,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  phone?: string;
  callLabel?: string;
}) {
  return (
    <section className="bg-card flex flex-col items-center gap-3 rounded-2xl border p-8 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-muted-foreground text-sm">{body}</p>
      {phone && callLabel ? (
        <Button asChild variant="outline" className="mt-2">
          <a href={`tel:${phone}`}>
            <Phone className="size-4" />
            {callLabel}
          </a>
        </Button>
      ) : null}
    </section>
  );
}

function Stars({
  value,
  onChange,
  readOnly,
  labels,
}: {
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  labels?: string[];
}) {
  return (
    <div
      className="flex justify-center gap-1.5 sm:gap-2"
      role={readOnly ? "img" : "radiogroup"}
      aria-label={readOnly ? `${value}/5` : undefined}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= value;
        const icon = (
          <Star
            aria-hidden
            className={cn(
              "size-10 transition-transform sm:size-11",
              on ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
            )}
          />
        );
        if (readOnly) return <span key={i}>{icon}</span>;
        return (
          <Button
            key={i}
            type="button"
            variant="ghost"
            role="radio"
            aria-checked={value === i}
            aria-label={labels?.[i - 1] ?? String(i)}
            className="size-12 p-0 active:scale-90 sm:size-14"
            onClick={() => onChange?.(i)}
          >
            {icon}
          </Button>
        );
      })}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path
        fill="#fff"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.64 4.1-5.35 4.1a5.95 5.95 0 0 1 0-11.9c1.85 0 3.1.79 3.8 1.47l2.6-2.5C16.8 3.73 14.6 2.8 12 2.8a9.2 9.2 0 1 0 0 18.4c5.3 0 8.83-3.73 8.83-8.98 0-.6-.07-1.06-.15-1.52Z"
      />
    </svg>
  );
}
