import { z } from "zod";

// TODO(finance): patchAccountSchema (bank_name, iban, notes, is_default, is_active), patchCategorySchema,
// payment_method enum validation, reference_no on transaction/transfer schemas.

export function createTransactionSchema(
  type: "income" | "expense",
  t: (key: string) => string,
) {
  const base = z.object({
    account_uuid: z
      .string()
      .min(1, t("finance.transactions.validation.account")),
    amount: z.string().min(1, t("finance.transactions.validation.amount")),
    transaction_date: z
      .string()
      .min(1, t("finance.transactions.validation.date")),
    description: z.string().optional(),
    payment_method: z.string().optional(),
  });

  if (type === "expense") {
    return base.extend({
      category_uuid: z
        .string()
        .min(1, t("finance.transactions.validation.category")),
    });
  }

  return base.extend({
    category_uuid: z.string().optional(),
  });
}

export function createTransferSchema(t: (key: string) => string) {
  return z
    .object({
      from_account_uuid: z
        .string()
        .min(1, t("finance.transfers.validation.from")),
      to_account_uuid: z.string().min(1, t("finance.transfers.validation.to")),
      amount: z.string().min(1, t("finance.transfers.validation.amount")),
      transaction_date: z
        .string()
        .min(1, t("finance.transactions.validation.date")),
      description: z.string().optional(),
    })
    .refine((data) => data.from_account_uuid !== data.to_account_uuid, {
      message: t("finance.transfers.validation.same_account"),
      path: ["to_account_uuid"],
    });
}

export function createAccountSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().min(1, t("finance.accounts.validation.name")),
    type: z.enum(["cash", "bank"]),
    currency: z
      .string()
      .min(3, t("finance.accounts.validation.currency"))
      .max(3),
    opening_balance: z.string().optional(),
  });
}

export function createCategorySchema(t: (key: string) => string) {
  return z.object({
    name: z.string().min(1, t("finance.categories.validation.name")),
    kind: z.enum(["income", "expense"]),
  });
}

export type TransactionFormValues = z.infer<
  ReturnType<typeof createTransactionSchema>
>;
export type TransferFormValues = z.infer<
  ReturnType<typeof createTransferSchema>
>;
export type AccountFormValues = z.infer<ReturnType<typeof createAccountSchema>>;
export type CategoryFormValues = z.infer<
  ReturnType<typeof createCategorySchema>
>;
