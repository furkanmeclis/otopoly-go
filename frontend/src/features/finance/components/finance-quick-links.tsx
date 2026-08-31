"use client";

import Link from "next/link";
import { ArrowRightLeft, FolderTree, List, Wallet } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/common/card";
import { routes } from "@/config/routes";
import { useLocale } from "@/providers/locale-provider";

export function FinanceQuickLinks({ slug }: { slug: string }) {
  const { t } = useLocale();

  const links = [
    {
      title: t("layout.nav_finance_accounts"),
      description: t("finance.quick_links.accounts"),
      href: routes.tenant.finance.accounts.root(slug),
      icon: Wallet,
    },
    {
      title: t("layout.nav_finance_transactions"),
      description: t("finance.quick_links.transactions"),
      href: routes.tenant.finance.transactions.root(slug),
      icon: List,
    },
    {
      title: t("layout.nav_finance_categories"),
      description: t("finance.quick_links.categories"),
      href: routes.tenant.finance.categories.root(slug),
      icon: FolderTree,
    },
    {
      title: t("finance.actions.transfer"),
      description: t("finance.quick_links.transfer"),
      href: `${routes.tenant.finance.root(slug)}?transfer=1`,
      icon: ArrowRightLeft,
    },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          {t("finance.quick_links.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("finance.quick_links.description")}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Card
              key={link.href}
              className="hover:border-primary/40 hover:bg-muted/30 shadow-none transition-colors"
            >
              <Link
                href={link.href}
                className="block focus-visible:outline-none"
              >
                <CardHeader className="flex flex-row items-center gap-3 space-y-0 pb-1">
                  <Icon className="text-muted-foreground size-4 shrink-0" />
                  <CardTitle className="text-sm font-medium">
                    {link.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-muted-foreground text-sm">
                    {link.description}
                  </p>
                </CardContent>
              </Link>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
