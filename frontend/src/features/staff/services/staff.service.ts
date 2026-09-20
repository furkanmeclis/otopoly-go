import { platformRequest } from "@/lib/api/platform-request";
import type { ResourceMeta } from "@/features/io/types";

export type StaffMember = {
  uuid: string;
  email: string;
  name: string;
  surname: string;
  status: string;
  role: string;
  created_at: string;
};

export type StaffOption = {
  uuid: string;
  email: string;
  name: string;
  surname: string;
  role: string;
  label: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type CreateStaffInput = {
  name: string;
  surname: string;
  email: string;
  password: string;
};

export const staffService = {
  meta() {
    return platformRequest<ResourceMeta>("GET", "/v1/tenant/staff/meta");
  },
  list() {
    return platformRequest<ListPage<StaffMember>>("GET", "/v1/tenant/staff");
  },
  options() {
    return platformRequest<{ items: StaffOption[] }>(
      "GET",
      "/v1/tenant/staff/options",
    );
  },
  create(body: CreateStaffInput) {
    return platformRequest<StaffMember>("POST", "/v1/tenant/staff", { body });
  },
  patch(uuid: string, body: { status: "active" | "inactive" }) {
    return platformRequest<StaffMember>("PATCH", `/v1/tenant/staff/${uuid}`, {
      body,
    });
  },
  resetPassword(uuid: string, body: { password: string }) {
    return platformRequest<{ ok: boolean }>(
      "POST",
      `/v1/tenant/staff/${uuid}/reset-password`,
      { body },
    );
  },
};
