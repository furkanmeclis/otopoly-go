import { request } from "@/api/client";
import type {
  CreateTodoInput,
  PatchTodoInput,
  Todo,
  TodoAssignee,
  TodoListParams,
  TodoPage,
  TodoSummary,
} from "@/features/todos/types";

export const todosService = {
  list(params: TodoListParams = {}) {
    return request<TodoPage>("GET", "/v1/tenant/todos", {
      query: {
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
        status: params.status,
        scope: params.scope,
        assignee: params.assignee,
        customer: params.customer,
        lead: params.lead,
        quote: params.quote,
        q: params.q,
      },
    });
  },
  summary() {
    return request<TodoSummary>("GET", "/v1/tenant/todos/summary", { silent: true });
  },
  assignees() {
    return request<TodoAssignee[]>("GET", "/v1/tenant/todos/assignees");
  },
  get(uuid: string) {
    return request<Todo>("GET", `/v1/tenant/todos/${uuid}`, { silent: true });
  },
  create(body: CreateTodoInput) {
    return request<Todo>("POST", "/v1/tenant/todos", { body });
  },
  patch(uuid: string, body: PatchTodoInput) {
    return request<Todo>("PATCH", `/v1/tenant/todos/${uuid}`, { body });
  },
  complete(uuid: string) {
    return request<Todo>("POST", `/v1/tenant/todos/${uuid}/complete`);
  },
  reopen(uuid: string) {
    return request<Todo>("POST", `/v1/tenant/todos/${uuid}/reopen`);
  },
  remove(uuid: string) {
    return request<{ deleted: boolean }>("DELETE", `/v1/tenant/todos/${uuid}`);
  },
};
