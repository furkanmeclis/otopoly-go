import { apiConfig } from "@/config/api";
import type { ResourceMeta } from "@/features/io/types";
import type {
  PublicReview,
  ReviewDetail,
  ReviewGoogleRedirect,
  ReviewListParams,
  ReviewPage,
  ReviewSettings,
  ReviewSummary,
  ReviewTestResult,
  UpdateReviewSettingsInput,
} from "@/features/reviews/types";
import { platformRequest } from "@/lib/api/platform-request";

const base = "/v1/tenant/reviews";

export const reviewsService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", `${base}/meta`);
  },
  list(params: ReviewListParams = {}) {
    const { include_tests, ...rest } = params;
    return platformRequest<ReviewPage>("GET", base, {
      query: {
        limit: 20,
        offset: 0,
        ...rest,
        include_tests: include_tests ? "true" : undefined,
      },
    });
  },
  summary(days = 30) {
    return platformRequest<ReviewSummary>("GET", `${base}/summary`, {
      query: { days },
    });
  },
  get(uuid: string) {
    return platformRequest<ReviewDetail>("GET", `${base}/${uuid}`);
  },
  followUp(uuid: string, note: string) {
    return platformRequest<ReviewDetail>("POST", `${base}/${uuid}/follow-up`, {
      body: { note },
    });
  },
  settings() {
    return platformRequest<ReviewSettings>("GET", `${base}/settings`);
  },
  saveSettings(body: UpdateReviewSettingsInput) {
    return platformRequest<ReviewSettings>("PUT", `${base}/settings`, {
      body,
    });
  },
  sendTest(phone?: string) {
    return platformRequest<ReviewTestResult>("POST", `${base}/settings/test`, {
      body: phone ? { phone } : {},
    });
  },
};

export class PublicReviewError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

async function publicCall<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${apiConfig.baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => undefined)) as
    { data?: T; error?: { code?: string } } | undefined;
  if (!response.ok || !payload?.data) {
    throw new PublicReviewError(
      payload?.error?.code ?? `HTTP_${response.status}`,
      response.status,
    );
  }
  return payload.data;
}

/** Public review page calls (no session; never emits global error toasts). */
export const publicReviewsService = {
  get(token: string) {
    return publicCall<PublicReview>(
      "GET",
      `/v1/public/reviews/${encodeURIComponent(token)}`,
    );
  },
  answer(
    token: string,
    body: { score: number; comment?: string; consent?: boolean },
  ) {
    return publicCall<PublicReview>(
      "POST",
      `/v1/public/reviews/${encodeURIComponent(token)}`,
      body,
    );
  },
  google(token: string) {
    return publicCall<ReviewGoogleRedirect>(
      "POST",
      `/v1/public/reviews/${encodeURIComponent(token)}/google`,
    );
  },
};
