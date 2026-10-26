import { z } from "zod";

export const PAPER_SIZES = ["A4", "A3", "Letter", "Legal"] as const;

export type PaperSize = (typeof PAPER_SIZES)[number];

/** Organization business types (`organizations.sector`). */
export const SECTORS = [
  "car_wash",
  "detailing",
  "ppf_tint",
  "auto_service",
  "tyres",
  "other",
] as const;

/** Select value for "not set" (Radix Select items cannot be empty). */
export const SECTOR_NONE = "none";

const SECTOR_VALUES = [SECTOR_NONE, ...SECTORS] as const;

export const settingsFormSchema = z.object({
  company_name: z.string().trim().min(1),
  tagline: z.string().trim(),
  primary_color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color"),
  paper_size: z.enum(PAPER_SIZES),
  address: z.string().trim(),
  city: z.string().trim(),
  district: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim(),
  website: z.string().trim(),
  footer_text: z.string().trim(),
  sector: z.enum(SECTOR_VALUES),
});

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export function normalizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  return fallback;
}

export function toSettingsFormValues(
  data: {
    company_name: string;
    tagline: string;
    primary_color: string;
    paper_size: string;
    address: string;
    city?: string;
    district?: string;
    phone: string;
    email: string;
    website: string;
    footer_text: string;
    sector?: string | null;
  },
  fallbackColor: string,
): SettingsFormValues {
  const paperSize = PAPER_SIZES.includes(data.paper_size as PaperSize)
    ? (data.paper_size as PaperSize)
    : "A4";

  return {
    company_name: data.company_name,
    tagline: data.tagline,
    primary_color: normalizeHexColor(data.primary_color, fallbackColor),
    paper_size: paperSize,
    address: data.address,
    city: data.city ?? "",
    district: data.district ?? "",
    phone: data.phone,
    email: data.email,
    website: data.website,
    footer_text: data.footer_text,
    sector: SECTORS.includes(data.sector as (typeof SECTORS)[number])
      ? (data.sector as (typeof SECTORS)[number])
      : SECTOR_NONE,
  };
}

/** PATCH body; `withSector` adds the business type (tenant settings only, `""` clears it). */
export function toPatchPayload(values: SettingsFormValues, withSector = false) {
  return {
    ...(withSector
      ? { sector: values.sector === SECTOR_NONE ? "" : values.sector }
      : {}),
    company_name: values.company_name,
    tagline: values.tagline,
    primary_color: values.primary_color,
    paper_size: values.paper_size,
    address: values.address,
    city: values.city,
    district: values.district,
    phone: values.phone,
    email: values.email,
    website: values.website,
    footer_text: values.footer_text,
  };
}
