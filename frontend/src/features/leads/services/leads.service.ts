import { platformRequest } from "@/lib/api/platform-request";
import type {
  CreateLeadInput,
  LeadAssignee,
  LeadDetail,
  LeadListParams,
  LeadPage,
  LeadSummary,
  LeadTodoInput,
  LeadTodoResult,
  PatchLeadInput,
} from "@/features/leads/types";

export const leadsService = {
  list(params: LeadListParams = {}) {
    return platformRequest<LeadPage>("GET", "/v1/tenant/leads", {
      query: { limit: 50, offset: 0, ...params },
    });
  },
  summary() {
    return platformRequest<LeadSummary>("GET", "/v1/tenant/leads/summary");
  },
  assignees() {
    return platformRequest<LeadAssignee[]>("GET", "/v1/tenant/leads/assignees");
  },
  get(uuid: string) {
    return platformRequest<LeadDetail>("GET", `/v1/tenant/leads/${uuid}`);
  },
  create(body: CreateLeadInput) {
    return platformRequest<LeadDetail>("POST", "/v1/tenant/leads", { body });
  },
  patch(uuid: string, body: PatchLeadInput) {
    return platformRequest<LeadDetail>("PATCH", `/v1/tenant/leads/${uuid}`, {
      body,
    });
  },
  remove(uuid: string) {
    return platformRequest<{ deleted: boolean }>(
      "DELETE",
      `/v1/tenant/leads/${uuid}`,
    );
  },
  addNote(uuid: string, body: string) {
    return platformRequest<LeadDetail>(
      "POST",
      `/v1/tenant/leads/${uuid}/notes`,
      { body: { body } },
    );
  },
  createTodo(uuid: string, body: LeadTodoInput) {
    return platformRequest<LeadTodoResult>(
      "POST",
      `/v1/tenant/leads/${uuid}/todo`,
      { body },
    );
  },
};
