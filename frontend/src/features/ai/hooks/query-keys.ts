export const aiKeys = {
  all: ["ai"] as const,
  settings: () => [...aiKeys.all, "settings"] as const,
  usage: (month: string) => [...aiKeys.all, "usage", month] as const,
  org: (uuid: string) => [...aiKeys.all, "org", uuid] as const,
  status: (slug: string) => [...aiKeys.all, "status", slug] as const,
  conversations: (slug: string) =>
    [...aiKeys.all, "conversations", slug] as const,
  conversationList: (slug: string, q: string) =>
    [...aiKeys.conversations(slug), "list", q] as const,
  conversation: (slug: string, uuid: string) =>
    [...aiKeys.conversations(slug), "detail", uuid] as const,
};
