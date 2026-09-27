import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { aiKeys } from "@/features/ai/hooks/query-keys";
import type {
  AIVoiceDownloadStatus,
  AIVoiceModelsResult,
} from "@/features/ai/types";

type Envelope<T> = { success: boolean; data?: T; error?: { message?: string } };

async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as Envelope<T>;
  if (!res.ok || !body.success || body.data === undefined) {
    throw new Error(body.error?.message ?? "Request failed");
  }
  return body.data;
}

export const aiVoiceModelsService = {
  list(language: string) {
    const q = new URLSearchParams();
    if (language) q.set("language", language);
    return apiJSON<AIVoiceModelsResult>(
      `/v1/platform/ai/voice/models${q.size ? `?${q}` : ""}`,
    );
  },
  download(modelId: string) {
    return apiJSON<AIVoiceDownloadStatus>(
      "/v1/platform/ai/voice/models/download",
      { method: "POST", body: JSON.stringify({ model_id: modelId }) },
    );
  },
};

export function useVoiceModels(language: string, enabled = true) {
  return useQuery({
    queryKey: aiKeys.voiceModels(language || "tr"),
    queryFn: () => aiVoiceModelsService.list(language || "tr"),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.available.some(
        (m) => m.download?.state === "downloading",
      )
        ? 3000
        : false,
  });
}

export function useDownloadVoiceModel(language: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => aiVoiceModelsService.download(modelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.voiceModels(language || "tr") });
    },
  });
}
