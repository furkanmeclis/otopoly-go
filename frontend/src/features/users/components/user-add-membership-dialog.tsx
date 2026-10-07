"use client";

import { useMemo } from "react";

import { AppForm, AppSelect, FormActions } from "@/components/forms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OrganizationAsyncPicker } from "@/features/organizations";
import { ORGANIZATION_MEMBER_ROLES } from "@/features/organizations/constants";
import { useAddOrganizationMember } from "@/features/organizations/hooks/use-organization-mutations";
import { useInvalidateUserInsights } from "@/features/users/hooks/use-user-mutations";
import {
  addUserMembershipFormSchema,
  type AddUserMembershipFormValues,
} from "@/features/users/schemas/user-form";
import { useLocale } from "@/providers/locale-provider";

type UserAddMembershipDialogProps = {
  userUuid: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Adds the user to an organization via the platform members endpoint. */
export function UserAddMembershipDialog({
  userUuid,
  open,
  onOpenChange,
}: UserAddMembershipDialogProps) {
  const { t } = useLocale();
  const addMember = useAddOrganizationMember();
  const invalidate = useInvalidateUserInsights();
  const schema = addUserMembershipFormSchema(t);

  const roleOptions = useMemo(
    () =>
      ORGANIZATION_MEMBER_ROLES.map((role) => ({
        value: role,
        label: t(`organizations.roles.${role}`),
      })),
    [t],
  );

  const handleSubmit = async (values: AddUserMembershipFormValues) => {
    await addMember.mutateAsync({
      uuid: values.organization_uuid,
      body: { user_uuid: userUuid, role: values.role },
    });
    void invalidate(userUuid);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("users.memberships.add_title")}</DialogTitle>
          <DialogDescription>
            {t("users.memberships.add_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          schema={schema}
          defaultValues={{ organization_uuid: "", role: "staff" }}
          onSubmit={handleSubmit}
        >
          <div className="space-y-4">
            <OrganizationAsyncPicker
              name="organization_uuid"
              label={t("users.memberships.organization")}
            />
            <AppSelect
              name="role"
              label={t("users.memberships.role")}
              options={roleOptions}
            />
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={addMember.isPending}
              >
                {t("form.cancel")}
              </Button>
              <Button type="submit" disabled={addMember.isPending}>
                {t("users.memberships.add")}
              </Button>
            </FormActions>
          </div>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
