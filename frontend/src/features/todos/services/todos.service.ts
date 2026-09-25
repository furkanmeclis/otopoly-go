import { apiClient, unwrap } from "@/lib/api";
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
  async list(params: TodoListParams = {}) {
    return unwrap<TodoPage>(
      await apiClient.GET("/v1/tenant/todos", {
        params: {
          query: {
            limit: params.limit ?? 50,
            offset: params.offset ?? 0,
            ...(params.status ? { status: params.status } : {}),
            ...(params.scope ? { scope: params.scope } : {}),
            ...(params.assignee ? { assignee: params.assignee } : {}),
            ...(params.q ? { q: params.q } : {}),
          },
        },
      }),
    );
  },
  async summary() {
    return unwrap<TodoSummary>(
      await apiClient.GET("/v1/tenant/todos/summary"),
      {
        silent: true,
      },
    );
  },
  async assignees() {
    return unwrap<TodoAssignee[]>(
      await apiClient.GET("/v1/tenant/todos/assignees"),
    );
  },
  async get(uuid: string) {
    return unwrap<Todo>(
      await apiClient.GET("/v1/tenant/todos/{uuid}", {
        params: { path: { uuid } },
      }),
      { silent: true },
    );
  },
  async create(body: CreateTodoInput) {
    return unwrap<Todo>(await apiClient.POST("/v1/tenant/todos", { body }));
  },
  async patch(uuid: string, body: PatchTodoInput) {
    return unwrap<Todo>(
      await apiClient.PATCH("/v1/tenant/todos/{uuid}", {
        params: { path: { uuid } },
        body,
      }),
    );
  },
  async complete(uuid: string) {
    return unwrap<Todo>(
      await apiClient.POST("/v1/tenant/todos/{uuid}/complete", {
        params: { path: { uuid } },
      }),
    );
  },
  async reopen(uuid: string) {
    return unwrap<Todo>(
      await apiClient.POST("/v1/tenant/todos/{uuid}/reopen", {
        params: { path: { uuid } },
      }),
    );
  },
  async remove(uuid: string) {
    return unwrap<{ deleted: boolean }>(
      await apiClient.DELETE("/v1/tenant/todos/{uuid}", {
        params: { path: { uuid } },
      }),
    );
  },
};
