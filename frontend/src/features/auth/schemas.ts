import { z } from "zod";

type Translate = (key: string) => string;

/** UI validation aligned with backend password policy (not an API DTO). */
export function passwordPolicySchema(t: Translate) {
  return z
    .string()
    .min(8, t("auth.validation.password_min"))
    .regex(/[A-Z]/, t("auth.validation.password_upper"))
    .regex(/[a-z]/, t("auth.validation.password_lower"))
    .regex(/[0-9]/, t("auth.validation.password_digit"));
}

export function createLoginSchema(t: Translate) {
  return z.object({
    email: z.email(t("auth.validation.email")),
    password: z.string().min(1, t("auth.validation.password_required")),
  });
}

export type LoginFormValues = z.infer<ReturnType<typeof createLoginSchema>>;

/**
 * Business fields shared by the public sign-up wizard and the signed-in
 * create-business flow. Limits mirror the API (organization_name 2-120,
 * phone <= 32, city / district <= 100, address <= 500).
 */
function businessFields(t: Translate) {
  const tooLong = t("register.validation.too_long");
  return {
    organization_name: z
      .string()
      .trim()
      .min(1, t("register.validation.organization_name_required"))
      .min(2, t("register.validation.organization_name_length"))
      .max(120, t("register.validation.organization_name_length")),
    city: z
      .string()
      .min(1, t("register.validation.city_required"))
      .max(100, tooLong),
    district: z
      .string()
      .min(1, t("register.validation.district_required"))
      .max(100, tooLong),
    phone: z
      .string()
      .min(1, t("register.validation.phone_required"))
      .max(32, tooLong),
    address: z
      .string()
      .min(1, t("register.validation.address_required"))
      .max(500, tooLong),
  };
}

export function createOrganizationRegisterSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("auth.validation.name_required")),
    surname: z.string().min(1, t("auth.validation.surname_required")),
    email: z.email(t("auth.validation.email")),
    password: passwordPolicySchema(t),
    ...businessFields(t),
  });
}

/**
 * Signed-in create-business flow: the account step is skipped, so the account
 * fields are accepted as-is (they stay empty and are never sent).
 */
export function createOwnedBusinessSchema(t: Translate) {
  return createOrganizationRegisterSchema(t).extend({
    name: z.string(),
    surname: z.string(),
    email: z.string(),
    password: z.string(),
  });
}

export type OrganizationRegisterFormValues = z.infer<
  ReturnType<typeof createOrganizationRegisterSchema>
>;

export function createTenantLoginSchema(t: Translate) {
  return z.object({
    email: z.email(t("auth.validation.email")),
    password: z.string().min(1, t("auth.validation.password_required")),
  });
}

export type TenantLoginFormValues = z.infer<
  ReturnType<typeof createTenantLoginSchema>
>;

export function createRegisterSchema(t: Translate) {
  return z.object({
    email: z.email(t("auth.validation.email")),
    name: z.string().min(1, t("auth.validation.name_required")),
    surname: z.string().min(1, t("auth.validation.surname_required")),
    password: passwordPolicySchema(t),
  });
}

export type RegisterFormValues = z.infer<
  ReturnType<typeof createRegisterSchema>
>;

export function createForgotPasswordSchema(t: Translate) {
  return z.object({
    email: z.email(t("auth.validation.email")),
  });
}

export type ForgotPasswordFormValues = z.infer<
  ReturnType<typeof createForgotPasswordSchema>
>;

export function createResetPasswordSchema(t: Translate) {
  return z
    .object({
      email: z.email(t("auth.validation.email")),
      code: z.string().min(1, t("auth.validation.code_required")),
      password: passwordPolicySchema(t),
      confirm_password: z
        .string()
        .min(1, t("auth.validation.confirm_required")),
    })
    .refine((v) => v.password === v.confirm_password, {
      message: t("auth.validation.password_mismatch"),
      path: ["confirm_password"],
    });
}

export type ResetPasswordFormValues = z.infer<
  ReturnType<typeof createResetPasswordSchema>
>;

export function createVerifyEmailSchema(t: Translate) {
  return z.object({
    email: z.email(t("auth.validation.email")),
    code: z.string().min(1, t("auth.validation.code_required")),
  });
}

export type VerifyEmailFormValues = z.infer<
  ReturnType<typeof createVerifyEmailSchema>
>;

export function createChangePasswordSchema(t: Translate) {
  return z
    .object({
      current_password: z
        .string()
        .min(1, t("auth.validation.password_required")),
      new_password: passwordPolicySchema(t),
      confirm_password: z
        .string()
        .min(1, t("auth.validation.confirm_required")),
    })
    .refine((v) => v.new_password === v.confirm_password, {
      message: t("auth.validation.password_mismatch"),
      path: ["confirm_password"],
    });
}

export type ChangePasswordFormValues = z.infer<
  ReturnType<typeof createChangePasswordSchema>
>;

export function createProfileSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("auth.validation.name_required")),
    surname: z.string().min(1, t("auth.validation.surname_required")),
  });
}

export type ProfileFormValues = z.infer<ReturnType<typeof createProfileSchema>>;

export function createNotificationPreferencesSchema() {
  return z.object({
    email_enabled: z.boolean(),
    inapp_enabled: z.boolean(),
    realtime_enabled: z.boolean(),
    push_enabled: z.boolean(),
  });
}

export type NotificationPreferencesFormValues = z.infer<
  ReturnType<typeof createNotificationPreferencesSchema>
>;
