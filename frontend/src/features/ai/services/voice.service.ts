import { apiClient, unwrap } from "@/lib/api";
import { ApiError, parseApiError } from "@/lib/api/errors";
import type { AITranscription, AIVoiceTestResult } from "@/features/ai/types";

/** Voice goes browser → BFF (/api/v1) → Go → Speaches; never to Speaches directly. */
export const aiVoiceService = {
  async transcribe(audio: Blob, signal?: AbortSignal) {
    const form = new FormData();
    const ext = audio.type.includes("mp4")
      ? "m4a"
      : audio.type.includes("ogg")
        ? "ogg"
        : "webm";
    form.append("file", audio, `voice.${ext}`);
    return unwrap<AITranscription>(
      await apiClient.POST("/v1/tenant/ai/voice/transcribe", {
        // openapi-fetch passes FormData through untouched (browser sets the boundary).
        body: form as unknown as { file: string },
        signal,
      }),
      { silent: true },
    );
  },

  /** Returns MP3 audio for assistant text (Markdown is cleaned server-side). */
  async speech(text: string, signal?: AbortSignal): Promise<Blob> {
    const { data, error, response } = await apiClient.POST(
      "/v1/tenant/ai/voice/speech",
      { body: { text }, parseAs: "blob", signal },
    );
    if (!response.ok)
      throw parseApiError(response.status, error, { emitLimitEvent: false });
    if (!(data instanceof Blob) || data.size === 0) {
      throw new ApiError({
        status: response.status,
        code: "AI_VOICE_UNAVAILABLE",
        message: "empty audio",
      });
    }
    return data;
  },

  async test(body: {
    base_url?: string;
    stt_model?: string;
    tts_voice?: string;
  }) {
    return unwrap<AIVoiceTestResult>(
      await apiClient.POST("/v1/platform/ai/voice/test", { body }),
    );
  },
};
