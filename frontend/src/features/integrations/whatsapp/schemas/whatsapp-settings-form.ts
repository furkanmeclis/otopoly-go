import { z } from "zod";

export const whatsappSettingsFormSchema = z.object({
  provider: z.enum(["none", "whatsmeow", "cloud"]),
  app_id: z.string().trim(),
  waba_id: z.string().trim(),
  phone_number_id: z.string().trim(),
  api_version: z.string().trim(),
  display_phone: z.string().trim(),
  access_token: z.string().trim().optional(),
  app_secret: z.string().trim().optional(),
  webhook_verify_token: z.string().trim().optional(),
});

export type WhatsAppSettingsFormValues = z.infer<
  typeof whatsappSettingsFormSchema
>;
