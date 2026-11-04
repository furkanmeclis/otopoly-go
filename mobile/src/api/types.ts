/** Shared list contracts (backend API_CONVENTIONS.md "Lists"). */
export type ServerListParams = {
  limit: number;
  offset: number;
  sort?: string;
  q?: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
