"use client";

import Link from "next/link";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { useLocale } from "@/providers/locale-provider";

export type CatalogTab =
  "brands" | "models" | "types" | "unresolved" | "imports" | "logos";

const TABS: { id: CatalogTab; href: string; labelKey: string }[] = [
  {
    id: "brands",
    href: routes.platform.vehicleCatalog.brands,
    labelKey: "vehicle_catalog.tabs.brands",
  },
  {
    id: "models",
    href: routes.platform.vehicleCatalog.models,
    labelKey: "vehicle_catalog.tabs.models",
  },
  {
    id: "types",
    href: routes.platform.vehicleCatalog.types,
    labelKey: "vehicle_catalog.tabs.types",
  },
  {
    id: "unresolved",
    href: routes.platform.vehicleCatalog.unresolved,
    labelKey: "vehicle_catalog.tabs.unresolved",
  },
  {
    id: "imports",
    href: routes.platform.vehicleCatalog.imports,
    labelKey: "vehicle_catalog.tabs.imports",
  },
  {
    id: "logos",
    href: routes.platform.vehicleCatalog.logos,
    labelKey: "vehicle_catalog.tabs.logos",
  },
];

/** Route-backed tabs shared by the catalog list pages. */
export function CatalogTabs({ active }: { active: CatalogTab }) {
  const { t } = useLocale();
  return (
    <Tabs value={active} className="mb-4">
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id} asChild>
            <Link href={tab.href}>{t(tab.labelKey)}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function useCatalogBreadcrumbs(current: string) {
  const { t } = useLocale();
  return [
    { label: t("layout.breadcrumb_home"), href: routes.platform.home },
    {
      label: t("vehicle_catalog.title"),
      href: routes.platform.vehicleCatalog.root,
    },
    { label: current },
  ];
}
