export const usersKeys = {
  all: ["users"] as const,
  lists: () => [...usersKeys.all, "list"] as const,
  list: (params: Record<string, unknown>) =>
    [...usersKeys.lists(), params] as const,
  details: () => [...usersKeys.all, "detail"] as const,
  detail: (uuid: string) => [...usersKeys.details(), uuid] as const,
  meta: () => [...usersKeys.all, "meta"] as const,
  navStats: () => [...usersKeys.all, "nav-stats"] as const,
  /** 360° detail sections, all under `insights(uuid)` for one-shot invalidation. */
  insights: (uuid: string) => [...usersKeys.all, "insights", uuid] as const,
  overview: (uuid: string) =>
    [...usersKeys.insights(uuid), "overview"] as const,
  organizations: (uuid: string, params: Record<string, unknown>) =>
    [...usersKeys.insights(uuid), "organizations", params] as const,
  sessions: (uuid: string, params: Record<string, unknown>) =>
    [...usersKeys.insights(uuid), "sessions", params] as const,
  devices: (uuid: string, params: Record<string, unknown>) =>
    [...usersKeys.insights(uuid), "devices", params] as const,
  activity: (uuid: string, params: Record<string, unknown>) =>
    [...usersKeys.insights(uuid), "activity", params] as const,
};
