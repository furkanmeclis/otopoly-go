import type { ServerListParams } from "@/components/entity";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type SignerSlot = {
  role: string;
  label: string;
  required: boolean;
};

export type ContractPreset = {
  uuid: string;
  title: string;
  description: string;
  category: string;
  content_json: unknown;
  content_html: string;
  variables: string[];
  signer_slots: SignerSlot[];
  signature_required: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreatePresetInput = {
  title: string;
  description?: string;
  category?: string;
  content_json?: unknown;
  content_html?: string;
  variables?: string[];
  signer_slots?: SignerSlot[];
  signature_required?: boolean;
  is_active?: boolean;
};

export type PatchPresetInput = Partial<CreatePresetInput>;

export const DEFAULT_SIGNER_SLOTS: SignerSlot[] = [
  { role: "customer", label: "Customer", required: true },
  { role: "staff", label: "Staff", required: true },
];

export const CONTRACT_VARIABLES = [
  "customer_name",
  "customer_phone",
  "customer_email",
  "plate",
  "vehicle_label",
  "job_total",
  "job_currency",
  "job_notes",
  "org_name",
  "org_phone",
  "org_email",
  "org_address",
  "org_city",
  "org_district",
  "org_full_address",
  "org_website",
  "today",
] as const;

export const contractPresetsService = {
  meta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/platform/contract-presets/meta",
    );
  },
  list(params?: ServerListParams & { is_active?: string }) {
    return platformRequest<ListPage<ContractPreset>>(
      "GET",
      "/v1/platform/contract-presets",
      { query: params },
    );
  },
  get(uuid: string) {
    return platformRequest<ContractPreset>(
      "GET",
      `/v1/platform/contract-presets/${uuid}`,
    );
  },
  create(body: CreatePresetInput) {
    return platformRequest<ContractPreset>(
      "POST",
      "/v1/platform/contract-presets",
      { body },
    );
  },
  update(uuid: string, body: PatchPresetInput) {
    return platformRequest<ContractPreset>(
      "PATCH",
      `/v1/platform/contract-presets/${uuid}`,
      { body },
    );
  },
  remove(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/platform/contract-presets/${uuid}`,
    );
  },
};
