import {
  Activity,
  Bell,
  Building2,
  Download,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LogIn,
  ScrollText,
  Settings2,
  Shield,
  Upload,
  UserRound,
  Wallet,
  Package,
  Wrench,
  Layers,
  Car,
  Users,
  Receipt,
} from "lucide-react";

import { appleNavIcon } from "@/components/icons/apple-icon";
import { facebookNavIcon } from "@/components/icons/facebook-icon";
import { githubNavIcon } from "@/components/icons/github-icon";
import { googleNavIcon } from "@/components/icons/google-icon";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { defineNav } from "@/features/nav-engine";
import { usersNavItem } from "@/features/users/nav";

export const platformNav = defineNav({
  id: "platform",
  groups: [
    {
      id: "general",
      labelKey: "layout.nav_platform",
      icon: LayoutDashboard,
      defaultOpen: true,
      items: [
        {
          id: "home",
          titleKey: "layout.home",
          href: routes.platform.home,
          icon: LayoutDashboard,
        },
      ],
    },
    {
      id: "manage",
      labelKey: "layout.section_manage",
      icon: Shield,
      defaultOpen: true,
      items: [
        usersNavItem,
        {
          id: "organizations",
          titleKey: "layout.nav_organizations",
          href: routes.platform.organizations.root,
          icon: Building2,
          permission: permissions.organizations.read,
        },
        {
          id: "vehicle-brands",
          titleKey: "layout.nav_vehicle_brands",
          href: routes.platform.vehicleBrands.root,
          icon: Car,
          permission: permissions.vehicleBrands.read,
        },
        {
          id: "roles",
          titleKey: "layout.nav_roles",
          href: routes.platform.roles.root,
          icon: Shield,
          permission: permissions.roles.read,
        },
        {
          id: "notifications",
          titleKey: "layout.nav_notifications",
          href: routes.platform.notifications.root,
          icon: Bell,
          permission: permissions.notifications.platformRead,
        },
        {
          id: "activity",
          titleKey: "layout.nav_activity",
          href: routes.platform.activity.root,
          icon: Activity,
          permission: permissions.activity.read,
        },
        {
          id: "logs",
          titleKey: "layout.nav_logs",
          href: routes.platform.logs.root,
          icon: ScrollText,
          permission: permissions.logs.read,
        },
        {
          id: "storage",
          titleKey: "layout.nav_storage",
          href: routes.platform.storage.root,
          icon: HardDrive,
          permission: permissions.storage.read,
        },
        {
          id: "access",
          titleKey: "layout.nav_access",
          href: routes.platform.access.root,
          icon: KeyRound,
          permission: permissions.access.read,
        },
      ],
    },
    {
      id: "auth-methods",
      labelKey: "layout.section_auth_methods",
      icon: LogIn,
      defaultOpen: true,
      items: [
        {
          id: "auth-settings",
          titleKey: "layout.nav_auth_settings",
          href: routes.platform.authSettings.root,
          icon: Settings2,
          permission: permissions.authSettings.read,
        },
        {
          id: "github-integration",
          titleKey: "layout.nav_github_integration",
          href: routes.platform.integrations.github,
          icon: githubNavIcon,
          searchIcon: "github",
          permission: permissions.integrations.github.read,
        },
        {
          id: "google-integration",
          titleKey: "layout.nav_google_integration",
          href: routes.platform.integrations.google,
          icon: googleNavIcon,
          permission: permissions.integrations.google.read,
        },
        {
          id: "facebook-integration",
          titleKey: "layout.nav_facebook_integration",
          href: routes.platform.integrations.facebook,
          icon: facebookNavIcon,
          permission: permissions.integrations.facebook.read,
        },
        {
          id: "apple-integration",
          titleKey: "layout.nav_apple_integration",
          href: routes.platform.integrations.apple,
          icon: appleNavIcon,
          permission: permissions.integrations.apple.read,
        },
      ],
    },
    {
      id: "io",
      labelKey: "layout.section_io",
      icon: Settings2,
      defaultOpen: true,
      items: [
        {
          id: "imports",
          titleKey: "layout.nav_imports",
          href: routes.platform.imports.root,
          icon: Upload,
          permission: permissions.imports.read,
        },
        {
          id: "exports",
          titleKey: "layout.nav_exports",
          href: routes.platform.exports.root,
          icon: Download,
          permission: permissions.exports.read,
        },
        {
          id: "export-settings",
          titleKey: "layout.nav_export_settings",
          href: routes.platform.settings.root,
          icon: Settings2,
          permission: permissions.settings.read,
        },
      ],
    },
  ],
});

export const cmsNav = defineNav({
  id: "cms",
  groups: [
    {
      id: "cms",
      labelKey: "layout.section_cms",
      icon: LayoutDashboard,
      defaultOpen: true,
      items: [
        {
          id: "home",
          titleKey: "layout.home",
          href: routes.cms.home,
          icon: LayoutDashboard,
        },
      ],
    },
  ],
});

export function tenantNav(slug: string) {
  return defineNav({
    id: "tenant",
    groups: [
      {
        id: "tenant",
        labelKey: "layout.section_tenant",
        icon: Building2,
        defaultOpen: true,
        items: [
          {
            id: "home",
            titleKey: "layout.home",
            href: routes.tenant.home(slug),
            icon: LayoutDashboard,
          },
          {
            id: "profile",
            titleKey: "layout.nav_profile",
            href: routes.tenant.profile.root(slug),
            icon: UserRound,
          },
        ],
      },
      {
        id: "finance",
        labelKey: "layout.section_finance",
        icon: Wallet,
        defaultOpen: true,
        // TODO(finance): Nav badges (pending receivables, negative balance count) via nav-engine when metrics API exists.
        items: [
          {
            id: "finance-summary",
            titleKey: "layout.nav_finance",
            href: routes.tenant.finance.root(slug),
            icon: Wallet,
            permission: permissions.finance.read,
          },
          {
            id: "finance-accounts",
            titleKey: "layout.nav_finance_accounts",
            href: routes.tenant.finance.accounts.root(slug),
            icon: Wallet,
            permission: permissions.finance.read,
          },
          {
            id: "finance-transactions",
            titleKey: "layout.nav_finance_transactions",
            href: routes.tenant.finance.transactions.root(slug),
            icon: ScrollText,
            permission: permissions.finance.read,
          },
          {
            id: "finance-categories",
            titleKey: "layout.nav_finance_categories",
            href: routes.tenant.finance.categories.root(slug),
            icon: Settings2,
            permission: permissions.finance.read,
          },
          {
            id: "cari",
            titleKey: "layout.nav_cari",
            href: routes.tenant.cari.root(slug),
            icon: Receipt,
            permission: permissions.cari.read,
          },
        ],
      },
      {
        id: "customers",
        labelKey: "layout.section_customers",
        icon: Users,
        defaultOpen: true,
        items: [
          {
            id: "customers",
            titleKey: "layout.nav_customers",
            href: routes.tenant.customers.root(slug),
            icon: Users,
            permission: permissions.customers.read,
          },
        ],
      },
      {
        id: "catalog",
        labelKey: "layout.section_catalog",
        icon: Package,
        defaultOpen: true,
        items: [
          {
            id: "catalog-products",
            titleKey: "layout.nav_catalog_products",
            href: routes.tenant.catalog.products.root(slug),
            icon: Package,
            permission: permissions.catalog.read,
          },
          {
            id: "catalog-services",
            titleKey: "layout.nav_catalog_services",
            href: routes.tenant.catalog.services.root(slug),
            icon: Wrench,
            permission: permissions.catalog.read,
          },
          {
            id: "catalog-categories",
            titleKey: "layout.nav_catalog_categories",
            href: routes.tenant.catalog.categories.root(slug),
            icon: Layers,
            permission: permissions.catalog.read,
          },
        ],
      },
      {
        id: "io",
        labelKey: "layout.section_io",
        icon: Settings2,
        defaultOpen: true,
        items: [
          {
            id: "tenant-exports",
            titleKey: "layout.nav_exports",
            href: routes.tenant.exports.root(slug),
            icon: Download,
            permission: permissions.finance.export,
          },
          {
            id: "tenant-imports",
            titleKey: "layout.nav_imports",
            href: routes.tenant.imports.root(slug),
            icon: Upload,
            permission: permissions.imports.tenantRead,
          },
          {
            id: "tenant-export-settings",
            titleKey: "layout.nav_export_settings",
            href: routes.tenant.settings.root(slug),
            icon: Settings2,
            permission: permissions.settings.tenantRead,
          },
        ],
      },
    ],
  });
}
