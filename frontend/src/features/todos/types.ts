import type { components } from "@/generated/api";

type Schemas = components["schemas"];

export type Todo = Schemas["Todo"];
export type TodoSummary = Schemas["TodoSummary"];
export type TodoAssignee = Schemas["TodoAssignee"];
export type CreateTodoInput = Schemas["CreateTodoRequest"];
export type PatchTodoInput = Schemas["PatchTodoRequest"];

export type TodoScope =
  "overdue" | "today" | "open_due" | "upcoming" | "no_date";

export type TodoListParams = {
  status?: "open" | "done";
  scope?: TodoScope;
  assignee?: string;
  customer?: string;
  lead?: string;
  quote?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type TodoPage = {
  items: Todo[];
  total: number;
  limit: number;
  offset: number;
};
