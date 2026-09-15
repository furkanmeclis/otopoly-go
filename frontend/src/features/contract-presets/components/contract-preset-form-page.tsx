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
  useContractPreset,
  useContractPresetMutations,
} from "@/features/contract-presets/hooks/use-contract-presets";
import {
  CONTRACT_VARIABLES,
  DEFAULT_SIGNER_SLOTS,
  type ContractPreset,
  type SignerSlot,
} from "@/features/contract-presets/services/contract-presets.service";
import { ContractContentEditor } from "@/features/contracts/components/contract-content-editor";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

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

const EMPTY: FormState = {
  title: "",
  description: "",
  category: "general",
  content_html: "<p></p>",
  content_json: {},
  variables: [...CONTRACT_VARIABLES],
  signer_slots: DEFAULT_SIGNER_SLOTS,
  signature_required: true,
  is_active: true,
};

function formFromPreset(data: ContractPreset): FormState {
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

function ContractPresetFormEditor({
  uuid,
  initial,
  canWrite,
}: {
  uuid?: string;
  initial: FormState;
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const isEdit = Boolean(uuid);
  const mutations = useContractPresetMutations();
  const [form, setForm] = useState<FormState>(initial);

  const breadcrumbs = useMemo(
    () => [
      { label: t("layout.breadcrumb_home"), href: routes.platform.home },
      {
        label: t("contracts.presets.title"),
        href: routes.platform.contractPresets.root,
      },
      {
        label: isEdit
          ? form.title || t("contracts.presets.edit_title")
          : t("contracts.presets.create_title"),
      },
    ],
    [form.title, isEdit, t],
  );

  const save = async () => {
    if (!canWrite || !form.title.trim()) return;
    const body = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category.trim() || "general",
      content_html: form.content_html,
      content_json: form.content_json,
      variables: form.variables,
      signer_slots: form.signer_slots.filter((s) => s.role.trim()),
      signature_required: form.signature_required,
      is_active: form.is_active,
    };
    if (isEdit && uuid) {
      await mutations.update.mutateAsync({ uuid, body });
    } else {
      const created = await mutations.create.mutateAsync(body);
      router.replace(routes.platform.contractPresets.detail(created.uuid));
    }
  };

  return (
    <EntityPage
      title={
        isEdit
          ? t("contracts.presets.edit_title")
          : t("contracts.presets.create_title")
      }
      description={t("contracts.presets.form_description")}
      breadcrumbs={breadcrumbs}
      actions={
        canWrite ? (
          <EntityActions>
            {isEdit && uuid ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={mutations.remove.isPending}
                onClick={async () => {
                  const ok = await confirmDelete({
                    title: t("contracts.presets.delete"),
                    description: t("contracts.presets.delete_confirm"),
                  });
                  if (!ok) return;
                  await mutations.remove.mutateAsync(uuid);
                  router.push(routes.platform.contractPresets.root);
                }}
              >
                {t("contracts.presets.delete")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={
                mutations.create.isPending || mutations.update.isPending
              }
              onClick={() => void save()}
            >
              {mutations.create.isPending || mutations.update.isPending
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
            key={uuid ?? "new"}
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

export function ContractPresetFormPage({
  uuid,
}: {
  uuid?: string;
}) {
  const { t } = useLocale();
  const { hasPermission } = usePermission();
  const canWrite = hasPermission(permissions.contractPresets.write);
  const isEdit = Boolean(uuid);
  const query = useContractPreset(uuid ?? "");

  if (!hasPermission(permissions.contractPresets.read)) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("contracts.presets.forbidden")}
      />
    );
  }

  if (isEdit && query.isLoading) {
    return <Loading label={t("common.loading")} />;
  }

  if (isEdit && (query.isError || !query.data)) {
    return (
      <ErrorState
        title={t("common.error_generic")}
        description={t("contracts.presets.error_description")}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const initial = isEdit && query.data ? formFromPreset(query.data) : EMPTY;
  const editorKey = isEdit && query.data ? query.data.uuid : "new";

  return (
    <ContractPresetFormEditor
      key={editorKey}
      uuid={uuid}
      initial={initial}
      canWrite={canWrite}
    />
  );
}
