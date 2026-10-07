"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { routes } from "@/config/routes";
import {
  useDeleteUser,
  useRestoreUser,
} from "@/features/users/hooks/use-user-mutations";
import { userFullName } from "@/features/users/lib/user-display";
import type { PublicUser } from "@/features/users/services/users.service";
import { isApiError } from "@/lib/api";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

type BlockingOrganization = {
  uuid: string;
  name: string;
};

type BlockedState = {
  user: PublicUser;
  organizations: BlockingOrganization[];
};

/** SOLE_ORGANIZATION_OWNER details: field = organization uuid, message = name. */
function blockingOrganizations(error: unknown): BlockingOrganization[] | null {
  if (!isApiError(error) || error.code !== "SOLE_ORGANIZATION_OWNER") {
    return null;
  }
  return error.details
    .filter((detail) => Boolean(detail.field))
    .map((detail) => ({
      uuid: detail.field ?? "",
      name: detail.message || detail.field || "",
    }));
}

function UserDeleteBlockedDialog({
  state,
  onClose,
}: {
  state: BlockedState | null;
  onClose: () => void;
}) {
  const { t } = useLocale();

  return (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("users.delete_blocked.title")}</DialogTitle>
          <DialogDescription>
            {state
              ? t("users.delete_blocked.description", {
                  name: userFullName(state.user),
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-border divide-y rounded-md border">
          {(state?.organizations ?? []).map((organization) => (
            <li key={organization.uuid} className="px-3 py-2.5">
              <Link
                href={routes.platform.organizations.detail(organization.uuid)}
                className="text-sm font-medium hover:underline"
                onClick={onClose}
              >
                {organization.name}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-sm">
          {t("users.delete_blocked.hint")}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete / restore actions shared by the user list and detail pages: confirm
 * dialog, step-up (via platformRequest) and the "only owner" blocked dialog.
 * Render `dialog` once in the page.
 */
export function useUserDeleteFlow() {
  const { t } = useLocale();
  const { confirm, confirmDelete } = useDialogs();
  const deleteUser = useDeleteUser();
  const restoreUser = useRestoreUser();
  const [blocked, setBlocked] = useState<BlockedState | null>(null);

  const requestDelete = useCallback(
    async (user: PublicUser) => {
      const confirmed = await confirmDelete({
        title: t("users.delete_title"),
        description: t("users.delete_description", {
          name: userFullName(user),
          email: user.email,
        }),
        confirmLabel: t("users.actions.delete"),
      });
      if (!confirmed) return false;
      try {
        await deleteUser.mutateAsync(user.uuid);
        return true;
      } catch (error) {
        const organizations = blockingOrganizations(error);
        if (organizations) setBlocked({ user, organizations });
        return false;
      }
    },
    [confirmDelete, deleteUser, t],
  );

  const requestRestore = useCallback(
    async (user: PublicUser) => {
      const confirmed = await confirm({
        title: t("users.restore_title"),
        description: t("users.restore_description", {
          name: userFullName(user),
          email: user.email,
        }),
        confirmLabel: t("users.actions.restore"),
      });
      if (!confirmed) return false;
      try {
        await restoreUser.mutateAsync(user.uuid);
        return true;
      } catch {
        return false;
      }
    },
    [confirm, restoreUser, t],
  );

  return {
    requestDelete,
    requestRestore,
    isPending: deleteUser.isPending || restoreUser.isPending,
    dialog: (
      <UserDeleteBlockedDialog
        state={blocked}
        onClose={() => setBlocked(null)}
      />
    ),
  };
}
