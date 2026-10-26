import { z } from "zod";

type Translate = (key: string) => string;

const appleId = /^[A-Za-z0-9]{10}$/;

/** APNs key upload / edit form; the API validates the .p8 itself. */
export function createApnsKeyFormSchema(t: Translate) {
  return z.object({
    key_id: z
      .string()
      .trim()
      .regex(appleId, t("integrations.apns.form.key_id_invalid")),
    team_id: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || appleId.test(v),
        t("integrations.apns.form.team_id_invalid"),
      ),
    bundle_id: z.string().trim(),
    environment: z.enum(["production", "sandbox"]),
    /** PEM text of the chosen .p8 file (never pre-filled from the API). */
    private_key: z.string(),
  });
}

export type ApnsKeyFormValues = z.infer<
  ReturnType<typeof createApnsKeyFormSchema>
>;
