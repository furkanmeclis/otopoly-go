export const routes = {
  public: {
    root: "/",
    register: "/register",
    health: "/health",
    share: {
      slug: (slug: string) => `/share/${slug}`,
      signed: (token: string) => `/share/s/${token}`,
    },
  },
  tenant: {
    home: (slug: string) => `/t/${slug}`,
    login: (slug: string) => `/t/${slug}/login`,
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
    },
    reports: {
      root: (slug: string) => `/t/${slug}/reports`,
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
      detail: (uuid: string) => `/platform/users/${uuid}`,
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
    access: {
      root: "/platform/access",
    },
    authSettings: {
      root: "/platform/auth/settings",
    },
    integrations: {
      github: "/platform/integrations/github",
      google: "/platform/integrations/google",
      facebook: "/platform/integrations/facebook",
      apple: "/platform/integrations/apple",
    },
    organizations: {
      root: "/platform/organizations",
      create: "/platform/organizations/create",
      detail: (uuid: string) => `/platform/organizations/${uuid}`,
      edit: (uuid: string) => `/platform/organizations/${uuid}/edit`,
    },
    vehicleBrands: {
      root: "/platform/vehicle-brands",
      detail: (uuid: string) => `/platform/vehicle-brands/${uuid}`,
    },
    contractPresets: {
      root: "/platform/contract-presets",
      create: "/platform/contract-presets/create",
      detail: (uuid: string) => `/platform/contract-presets/${uuid}`,
    },
    activity: {
      root: "/platform/activity",
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
