export const routes = {
  public: {
    root: "/",
    /** Business login: tenant users sign in here (`?next=/t/{slug}/...`). */
    login: "/login",
    loginWithNext: (next: string) => `/login?next=${encodeURIComponent(next)}`,
    register: "/register",
    privacy: "/privacy",
    privacyEn: "/en/privacy",
    terms: "/terms",
    termsEn: "/en/terms",
    /** Public account deletion / recovery (Google Play deletion URL). */
    accountDelete: "/account/delete",
    accountDeleteEn: "/en/account/delete",
    health: "/health",
    quote: (token: string) => `/q/${token}`,
    /** Customer review page (short link sent after delivery). */
    review: (token: string) => `/r/${token}`,
    share: {
      slug: (slug: string) => `/share/${slug}`,
      signed: (token: string) => `/share/s/${token}`,
    },
  },
  /** OAuth consent of MCP clients (outside the shells, needs a session). */
  oauth: {
    consent: "/oauth/consent",
  },
  onboarding: {
    /** Signed-in user without a business creates one (account step skipped). */
    business: "/onboarding/business",
  },
  tenant: {
    home: (slug: string) => `/t/${slug}`,
    profile: {
      root: (slug: string) => `/t/${slug}/profile`,
      password: (slug: string) => `/t/${slug}/profile/password`,
      preferences: (slug: string) => `/t/${slug}/profile/preferences`,
    },
    finance: {
      root: (slug: string) => `/t/${slug}/finance`,
      accounts: {
        root: (slug: string) => `/t/${slug}/finance/accounts`,
        detail: (slug: string, uuid: string) =>
          `/t/${slug}/finance/accounts/${uuid}`,
      },
      categories: {
        root: (slug: string) => `/t/${slug}/finance/categories`,
        detail: (slug: string, uuid: string) =>
          `/t/${slug}/finance/categories/${uuid}`,
      },
      transactions: {
        root: (slug: string) => `/t/${slug}/finance/transactions`,
        detail: (slug: string, uuid: string) =>
          `/t/${slug}/finance/transactions/${uuid}`,
        incomeNew: (slug: string) =>
          `/t/${slug}/finance/transactions/income/new`,
        expenseNew: (slug: string) =>
          `/t/${slug}/finance/transactions/expense/new`,
      },
      transfers: {
        new: (slug: string) => `/t/${slug}/finance/transfers/new`,
      },
    },
    customers: {
      root: (slug: string) => `/t/${slug}/customers`,
      detail: (slug: string, uuid: string) => `/t/${slug}/customers/${uuid}`,
    },
    cari: {
      root: (slug: string) => `/t/${slug}/cari`,
      detail: (slug: string, uuid: string) => `/t/${slug}/cari/${uuid}`,
    },
    operations: {
      root: (slug: string) => `/t/${slug}/operations`,
      detail: (slug: string, uuid: string) => `/t/${slug}/operations/${uuid}`,
    },
    staff: {
      root: (slug: string) => `/t/${slug}/staff`,
    },
    sales: {
      root: (slug: string) => `/t/${slug}/sales`,
      detail: (slug: string, uuid: string) => `/t/${slug}/sales/${uuid}`,
    },
    suppliers: {
      root: (slug: string) => `/t/${slug}/suppliers`,
      detail: (slug: string, uuid: string) => `/t/${slug}/suppliers/${uuid}`,
    },
    purchases: {
      root: (slug: string) => `/t/${slug}/purchases`,
      detail: (slug: string, uuid: string) => `/t/${slug}/purchases/${uuid}`,
      reorder: (slug: string) => `/t/${slug}/purchases/reorder`,
      reorderDrafts: (slug: string) =>
        `/t/${slug}/purchases/reorder?tab=drafts`,
    },
    reports: {
      root: (slug: string) => `/t/${slug}/reports`,
    },
    todos: {
      root: (slug: string) => `/t/${slug}/todos`,
    },
    calendar: {
      root: (slug: string) => `/t/${slug}/calendar`,
      /** Opens the calendar on a day (YYYY-MM-DD), optionally in a view. */
      day: (slug: string, date: string, view?: "day" | "week" | "agenda") =>
        `/t/${slug}/calendar?date=${encodeURIComponent(date)}${view ? `&view=${view}` : ""}`,
      /** Opens the calendar on an event's day with its dialog open. */
      event: (slug: string, uuid: string) =>
        `/t/${slug}/calendar?event=${encodeURIComponent(uuid)}`,
    },
    loyalty: {
      root: (slug: string) => `/t/${slug}/loyalty`,
      tab: (slug: string, tab: string) => `/t/${slug}/loyalty?tab=${tab}`,
      customerPackage: (slug: string, uuid: string) =>
        `/t/${slug}/loyalty/customer-packages/${uuid}`,
      subscription: (slug: string, uuid: string) =>
        `/t/${slug}/loyalty/subscriptions/${uuid}`,
    },
    leads: {
      root: (slug: string) => `/t/${slug}/leads`,
      detail: (slug: string, uuid: string) => `/t/${slug}/leads/${uuid}`,
    },
    reviews: {
      root: (slug: string) => `/t/${slug}/reviews`,
      detail: (slug: string, uuid: string) => `/t/${slug}/reviews/${uuid}`,
      settings: (slug: string) => `/t/${slug}/reviews/settings`,
    },
    quotes: {
      root: (slug: string) => `/t/${slug}/quotes`,
      new: (slug: string) => `/t/${slug}/quotes/new`,
      detail: (slug: string, uuid: string) => `/t/${slug}/quotes/${uuid}`,
      edit: (slug: string, uuid: string) => `/t/${slug}/quotes/${uuid}/edit`,
    },
    assistant: {
      root: (slug: string) => `/t/${slug}/assistant`,
      conversation: (slug: string, uuid: string) =>
        `/t/${slug}/assistant?c=${encodeURIComponent(uuid)}`,
    },
    contracts: {
      root: (slug: string) => `/t/${slug}/contracts`,
      templates: (slug: string) => `/t/${slug}/contracts/templates`,
      templateDetail: (slug: string, uuid: string) =>
        `/t/${slug}/contracts/templates/${uuid}`,
      instanceDetail: (slug: string, uuid: string) =>
        `/t/${slug}/contracts/instances/${uuid}`,
    },
    catalog: {
      root: (slug: string) => `/t/${slug}/catalog/products`,
      products: {
        root: (slug: string) => `/t/${slug}/catalog/products`,
        detail: (slug: string, uuid: string) =>
          `/t/${slug}/catalog/products/${uuid}`,
      },
      services: {
        root: (slug: string) => `/t/${slug}/catalog/services`,
        detail: (slug: string, uuid: string) =>
          `/t/${slug}/catalog/services/${uuid}`,
      },
      categories: {
        root: (slug: string) => `/t/${slug}/catalog/categories`,
        detail: (slug: string, uuid: string) =>
          `/t/${slug}/catalog/categories/${uuid}`,
      },
    },
    exports: {
      root: (slug: string) => `/t/${slug}/exports`,
      detail: (slug: string, uuid: string) => `/t/${slug}/exports/${uuid}`,
    },
    imports: {
      root: (slug: string) => `/t/${slug}/imports`,
      detail: (slug: string, uuid: string) => `/t/${slug}/imports/${uuid}`,
    },
    settings: {
      root: (slug: string) => `/t/${slug}/settings`,
      messaging: (slug: string) => `/t/${slug}/settings/messaging`,
      billing: (slug: string) => `/t/${slug}/settings/billing`,
      /** AI connections (MCP): connect guide + this business's connections. */
      mcp: (slug: string) => `/t/${slug}/settings/mcp`,
    },
  },
  guest: {
    login: "/platform/login",
    register: "/platform/register",
    forgotPassword: "/platform/forgot-password",
    resetPassword: "/platform/reset-password",
    verifyEmail: "/platform/verify-email",
  },
  cms: {
    root: "/",
    home: "/",
    profile: {
      root: "/profile",
      password: "/profile/password",
      preferences: "/profile/preferences",
    },
  },
  platform: {
    root: "/platform",
    home: "/platform",
    roles: {
      root: "/platform/roles",
      create: "/platform/roles/create",
      detail: (uuid: string) => `/platform/roles/${uuid}`,
      edit: (uuid: string) => `/platform/roles/${uuid}/edit`,
    },
    users: {
      root: "/platform/users",
      create: "/platform/users/create",
      /** `tab` deep-links a detail section (`?tab=sessions`, `activity`, …). */
      detail: (uuid: string, tab?: string) =>
        tab
          ? `/platform/users/${uuid}?tab=${encodeURIComponent(tab)}`
          : `/platform/users/${uuid}`,
      edit: (uuid: string) => `/platform/users/${uuid}/edit`,
    },
    notifications: {
      root: "/platform/notifications",
      detail: (uuid: string) => `/platform/notifications/${uuid}`,
    },
    imports: {
      root: "/platform/imports",
      detail: (uuid: string) => `/platform/imports/${uuid}`,
    },
    exports: {
      root: "/platform/exports",
      detail: (uuid: string) => `/platform/exports/${uuid}`,
    },
    settings: {
      root: "/platform/settings",
    },
    billing: {
      root: "/platform/billing",
      plans: "/platform/billing/plans",
      payments: "/platform/billing/payments",
      subscriptions: "/platform/billing/subscriptions",
      discountCodes: "/platform/billing/discount-codes",
      settings: "/platform/billing/settings",
      invoices: "/platform/billing/invoices",
    },
    access: {
      root: "/platform/access",
    },
    authSettings: {
      root: "/platform/auth/settings",
    },
    legal: {
      privacy: "/platform/legal/privacy",
      terms: "/platform/legal/terms",
    },
    integrations: {
      github: "/platform/integrations/github",
      google: "/platform/integrations/google",
      facebook: "/platform/integrations/facebook",
      apple: "/platform/integrations/apple",
      whatsapp: "/platform/integrations/whatsapp",
    },
    smsReport: {
      root: "/platform/sms-report",
      organization: (uuid: string) => `/platform/sms-report/${uuid}`,
    },
    organizations: {
      root: "/platform/organizations",
      create: "/platform/organizations/create",
      /** `tab` deep-links a detail section (`?tab=members`, `whatsapp`, …). */
      detail: (uuid: string, tab?: string) =>
        tab
          ? `/platform/organizations/${uuid}?tab=${encodeURIComponent(tab)}`
          : `/platform/organizations/${uuid}`,
      edit: (uuid: string) => `/platform/organizations/${uuid}/edit`,
    },
    /** Vehicle catalog (TSB kasko list): tabs brands / models / types / unresolved queue / imports / logos. */
    vehicleCatalog: {
      root: "/platform/vehicle-catalog",
      brands: "/platform/vehicle-catalog/brands",
      models: "/platform/vehicle-catalog/models",
      types: "/platform/vehicle-catalog/types",
      typeDetail: (uuid: string) => `/platform/vehicle-catalog/types/${uuid}`,
      unresolved: "/platform/vehicle-catalog/unresolved",
      imports: "/platform/vehicle-catalog/imports",
      importDetail: (uuid: string) =>
        `/platform/vehicle-catalog/imports/${uuid}`,
      logos: "/platform/vehicle-catalog/logos",
    },
    contractPresets: {
      root: "/platform/contract-presets",
      create: "/platform/contract-presets/create",
      detail: (uuid: string) => `/platform/contract-presets/${uuid}`,
    },
    activity: {
      root: "/platform/activity",
    },
    ai: {
      root: "/platform/ai",
    },
    /** MCP: connect guide, own connections, registered clients. */
    mcp: {
      root: "/platform/mcp",
    },
    logs: {
      root: "/platform/logs",
    },
    storage: {
      root: "/platform/storage",
    },
    profile: {
      root: "/platform/profile",
      password: "/platform/profile/password",
      preferences: "/platform/profile/preferences",
    },
  },
  errors: {
    unauthorized: "/unauthorized",
    forbidden: "/forbidden",
  },
} as const;

type NestedRoutes<T> = T extends string
  ? T
  : T extends (...args: never[]) => infer R
    ? R extends string
      ? R
      : never
    : T extends Record<string, unknown>
      ? NestedRoutes<T[keyof T]>
      : never;

export type AppRoute = NestedRoutes<typeof routes>;
