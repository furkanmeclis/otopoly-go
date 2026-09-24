import { z } from "zod";

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/.test(v), {
    message: "Must be an http(s) URL",
  });

export const aiSettingsFormSchema = z
  .object({
    provider: z.enum(["anthropic", "openai_compatible"]),
    api_key: z.string().trim().max(512).optional(),
    clear_api_key: z.boolean(),
    base_url: httpUrl,
    model: z.string().trim().min(1).max(128),
    title_model: z.string().trim().max(128),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    max_tokens: z.coerce.number().int().min(256).max(128000),
    feature_chat: z.boolean(),
    feature_charts: z.boolean(),
    feature_actions: z.boolean(),
    feature_todos: z.boolean(),
    feature_voice: z.boolean(),
    tools: z.record(z.string(), z.boolean()),
    extra_instructions: z.string().max(4000),
    default_monthly_token_quota: z.coerce.number().int().min(0),
    voice_base_url: httpUrl,
    voice_stt_model: z.string().trim().max(128),
    voice_tts_voice: z.string().trim().max(128),
    voice_language: z.string().trim().max(16),
  })
  .refine((v) => v.provider !== "openai_compatible" || v.base_url !== "", {
    message: "Base URL is required for OpenAI-compatible providers",
    path: ["base_url"],
  });

export type AISettingsFormValues = z.infer<typeof aiSettingsFormSchema>;
