import type { ServerListParams } from "@/components/entity";
import {
  platformDownloadFile,
  platformFormRequest,
  triggerBrowserDownload,
} from "@/lib/api/platform-form-request";
import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";
import type {
  ContractPreset,
  ListPage,
  SignerSlot,
} from "@/features/contract-presets/services/contract-presets.service";

export type ContractTemplate = {
  uuid: string;
  preset_uuid?: string | null;
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

export type ContractSigner = {
  uuid: string;
  role: string;
  label: string;
  required: boolean;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ContractSignature = {
  uuid: string;
  signer_uuid: string;
  display_name: string;
  object_key: string;
  url?: string | null;
  content_sha256: string;
  signed_by_user_id: number;
  ip_address: string;
  user_agent: string;
  signed_at: string;
};

export type ContractMedia = {
  uuid: string;
  object_key: string;
  url?: string | null;
  content_type: string;
  file_name: string;
  byte_size: number;
  caption: string;
  sort_order: number;
  created_at: string;
};

export type ContractInstance = {
  uuid: string;
  number: number;
  number_label: string;
  locale: string;
  template_uuid?: string | null;
  title: string;
  subject_type: string;
  subject_uuid: string;
  content_json: unknown;
  content_html: string;
  variables_resolved: Record<string, string>;
  signature_required: boolean;
  status: string;
  content_sha256?: string | null;
  pdf_object_key?: string | null;
  pdf_url?: string | null;
  pdf_error: string;
  executed_at?: string | null;
  voided_at?: string | null;
  created_at: string;
  updated_at: string;
  signers?: ContractSigner[];
  signatures?: ContractSignature[];
  media?: ContractMedia[];
};

export type CreateTemplateInput = {
  preset_uuid?: string;
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

export type PatchTemplateInput = Partial<CreateTemplateInput>;

export type CloneTemplateInput = {
  preset_uuid: string;
  title?: string;
};

export type CreateInstanceInput = {
  template_uuid: string;
  subject_type: string;
  subject_uuid: string;
  title?: string;
};

export type SignInput = {
  display_name: string;
  signature_png_base64: string;
};

export const contractsService = {
  templateMeta() {
    return platformRequest<ResourceMeta>(
      "GET",
      "/v1/tenant/contracts/templates/meta",
    );
  },
  listTemplates(params?: ServerListParams & { is_active?: string }) {
    return platformRequest<ListPage<ContractTemplate>>(
      "GET",
      "/v1/tenant/contracts/templates",
      { query: params },
    );
  },
  listPresets(params?: ServerListParams) {
    return platformRequest<ListPage<ContractPreset>>(
      "GET",
      "/v1/tenant/contracts/presets",
      { query: params },
    );
  },
  getTemplate(uuid: string) {
    return platformRequest<ContractTemplate>(
      "GET",
      `/v1/tenant/contracts/templates/${uuid}`,
    );
  },
  createTemplate(body: CreateTemplateInput) {
    return platformRequest<ContractTemplate>(
      "POST",
      "/v1/tenant/contracts/templates",
      { body },
    );
  },
  cloneTemplate(body: CloneTemplateInput) {
    return platformRequest<ContractTemplate>(
      "POST",
      "/v1/tenant/contracts/templates/clone",
      { body },
    );
  },
  updateTemplate(uuid: string, body: PatchTemplateInput) {
    return platformRequest<ContractTemplate>(
      "PATCH",
      `/v1/tenant/contracts/templates/${uuid}`,
      { body },
    );
  },
  removeTemplate(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/contracts/templates/${uuid}`,
    );
  },
  listInstances(
    params?: ServerListParams & {
      status?: string;
      subject_type?: string;
      subject_uuid?: string;
    },
  ) {
    return platformRequest<ListPage<ContractInstance>>(
      "GET",
      "/v1/tenant/contracts/instances",
      { query: params },
    );
  },
  getInstance(uuid: string) {
    return platformRequest<ContractInstance>(
      "GET",
      `/v1/tenant/contracts/instances/${uuid}`,
    );
  },
  createInstance(body: CreateInstanceInput) {
    return platformRequest<ContractInstance>(
      "POST",
      "/v1/tenant/contracts/instances",
      { body },
    );
  },
  voidInstance(uuid: string) {
    return platformRequest<ContractInstance>(
      "POST",
      `/v1/tenant/contracts/instances/${uuid}/void`,
    );
  },
  sign(instanceUuid: string, signerUuid: string, body: SignInput) {
    return platformRequest<ContractInstance>(
      "POST",
      `/v1/tenant/contracts/instances/${instanceUuid}/signers/${signerUuid}/sign`,
      { body },
    );
  },
  uploadMedia(instanceUuid: string, file: File, caption?: string) {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    return platformFormRequest<ContractMedia>(
      "POST",
      `/v1/tenant/contracts/instances/${instanceUuid}/media`,
      form,
    );
  },
  deleteMedia(instanceUuid: string, mediaUuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/contracts/instances/${instanceUuid}/media/${mediaUuid}`,
    );
  },
  async downloadPdf(instanceUuid: string) {
    const { blob, filename } = await platformDownloadFile(
      `/v1/tenant/contracts/instances/${instanceUuid}/pdf`,
    );
    triggerBrowserDownload(blob, filename ?? `contract-${instanceUuid}.pdf`);
  },
};
