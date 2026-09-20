"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import {
  EntityActions,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SignerSlotsEditor } from "@/features/contract-presets/components/signer-slots-editor";
import {
  CONTRACT_VARIABLES,
  DEFAULT_SIGNER_SLOTS,
  type SignerSlot,
} from "@/features/contract-presets/services/contract-presets.service";
import { ContractContentEditor } from "@/features/contracts/components/contract-content-editor";
import {
  useContractMutations,
  useContractTemplate,
} from "@/features/contracts/hooks/use-contracts";
import { useTenantContractsAccess } from "@/features/contracts/hooks/use-tenant-contracts-access";
import type { ContractTemplate } from "@/features/contracts/services/contracts.service";
import { routes } from "@/config/routes";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

type FormState = {
  title: string;
  description: string;
  category: string;
  content_html: string;
  content_json: unknown;
  variables: string[];
  signer_slots: SignerSlot[];
  signature_required: boolean;
  is_active: boolean;
};

function formFromTemplate(data: ContractTemplate): FormState {
  return {
    title: data.title,
    description: data.description ?? "",
    category: data.category || "general",
    content_html: data.content_html || "<p></p>",
    content_json: data.content_json ?? {},
    variables: data.variables?.length
      ? data.variables
      : [...CONTRACT_VARIABLES],
    signer_slots: data.signer_slots?.length
      ? data.signer_slots
      : DEFAULT_SIGNER_SLOTS,
    signature_required: data.signature_required,
    is_active: data.is_active,
  };
}

function variablesFromHtml(html: string): string[] {
  const found = new Set<string>();
  for (const key of CONTRACT_VARIABLES) {
    if (html.includes(`{{${key}}}`)) found.add(key);
  }
  return found.size > 0 ? [...found] : [...CONTRACT_VARIABLES];
}

function ContractTemplateFormEditor({
  slug,
  uuid,
  initial,
  canWrite,
}: {
  slug: string;
  uuid: string;
  initial: FormState;
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const mutations = useContractMutations();
  const [form, setForm] = useState<FormState>(initial);

  const breadcrumbs = useMemo(
    () => [
      { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
      {
        label: t("contracts.instances.title"),
        href: routes.tenant.contracts.root(slug),
      },
      {
        label: t("contracts.templates.title"),
        href: routes.tenant.contracts.templates(slug),
      },
      { label: form.title || t("contracts.templates.edit_title") },
    ],
    [form.title, slug, t],
  );

  const save = async () => {
    if (!canWrite || !form.title.trim()) return;
    await mutations.updateTemplate.mutateAsync({
      uuid,
      body: {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category.trim() || "general",
        content_html: form.content_html,
        content_json: form.content_json,
        variables: form.variables,
        signer_slots: form.signer_slots.filter((s) => s.role.trim()),
        signature_required: form.signature_required,
        is_active: form.is_active,
      },
    });
  };

  return (
    <EntityPage
      title={t("contracts.templates.edit_title")}
      description={t("contracts.templates.form_description")}
      breadcrumbs={breadcrumbs}
      actions={
        canWrite ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={mutations.removeTemplate.isPending}
              onClick={async () => {
                const ok = await confirmDelete({
                  title: t("contracts.templates.delete"),
                  description: t("contracts.templates.delete_confirm"),
                });
                if (!ok) return;
                await mutations.removeTemplate.mutateAsync(uuid);
                router.push(routes.tenant.contracts.templates(slug));
              }}
            >
              {t("contracts.templates.delete")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={mutations.updateTemplate.isPending}
              onClick={() => void save()}
            >
              {mutations.updateTemplate.isPending
                ? t("common.saving")
                : t("common.save")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      <div className="space-y-6">
        <EntitySectionCard title={t("contracts.sections.basics")}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="title">{t("contracts.fields.title")}</Label>
              <Input
                id="title"
                value={form.title}
                disabled={!canWrite}
                placeholder={t("contracts.fields.title_placeholder")}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">
                {t("contracts.fields.description")}
              </Label>
              <Input
                id="description"
                value={form.description}
                disabled={!canWrite}
                placeholder={t("contracts.fields.description_placeholder")}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
              />
            </div>
            <div className="flex flex-col gap-4 pt-2 md:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.signature_required}
                  disabled={!canWrite}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({
                      ...prev,
                      signature_required: checked,
                    }))
                  }
                />
                {t("contracts.fields.signature_required")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.is_active}
                  disabled={!canWrite}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, is_active: checked }))
                  }
                />
                {t("contracts.fields.active")}
              </label>
            </div>
          </div>
        </EntitySectionCard>

        <EntitySectionCard title={t("contracts.sections.body")}>
          <p className="text-muted-foreground mb-3 text-sm">
            {t("contracts.editor.help")}
          </p>
          <ContractContentEditor
            key={uuid}
            initialJson={initial.content_json}
            initialHtml={initial.content_html}
            editable={canWrite}
            onChange={({ content_html, content_json }) =>
              setForm((prev) => ({
                ...prev,
                content_html,
                content_json,
                variables: variablesFromHtml(content_html),
              }))
            }
          />
        </EntitySectionCard>

        <EntitySectionCard title={t("contracts.sections.signers")}>
          <SignerSlotsEditor
            value={form.signer_slots}
            disabled={!canWrite}
            onChange={(signer_slots) =>
              setForm((prev) => ({ ...prev, signer_slots }))
            }
          />
        </EntitySectionCard>
      </div>
    </EntityPage>
  );
}

export function ContractTemplateDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t } = useLocale();
  const { canRead, canManage } = useTenantContractsAccess(slug);
  const query = useContractTemplate(uuid);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("contracts.templates.forbidden")}
      />
    );
  }

  if (query.isLoading) {
    return <Loading label={t("common.loading")} />;
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={t("common.error_generic")}
        description={t("contracts.templates.error_description")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <ContractTemplateFormEditor
      key={query.data.uuid}
      slug={slug}
      uuid={uuid}
      initial={formFromTemplate(query.data)}
      canWrite={canManage}
    />
  );
}
