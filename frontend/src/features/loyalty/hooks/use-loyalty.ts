"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ServerListParams } from "@/components/entity";
import { permissions } from "@/config/permissions";
import {
  loyaltyService,
  type CampaignInput,
  type LoyaltyKind,
  type PackageInput,
  type PaymentInput,
  type PaymentMethod,
  type PlanInput,
} from "@/features/loyalty/services/loyalty.service";
import { usePermission } from "@/providers/permission-provider";
import { useLocale } from "@/providers/locale-provider";

export const loyaltyKeys = {
  all: ["tenant", "loyalty"] as const,
  overview: (days?: number) => [...loyaltyKeys.all, "overview", days] as const,
  campaigns: (p?: unknown) => [...loyaltyKeys.all, "campaigns", p] as const,
  packages: (p?: unknown) => [...loyaltyKeys.all, "packages", p] as const,
  plans: (p?: unknown) => [...loyaltyKeys.all, "plans", p] as const,
  customerPackages: (p?: unknown) =>
    [...loyaltyKeys.all, "customer-packages", p] as const,
  customerPackage: (uuid: string) =>
    [...loyaltyKeys.all, "customer-package", uuid] as const,
  subscriptions: (p?: unknown) =>
    [...loyaltyKeys.all, "subscriptions", p] as const,
  subscription: (uuid: string) =>
    [...loyaltyKeys.all, "subscription", uuid] as const,
  customer: (uuid: string) => [...loyaltyKeys.all, "customer", uuid] as const,
  job: (uuid: string) => [...loyaltyKeys.all, "job", uuid] as const,
};

/** tenant.loyalty.read / apply (owner + staff) / write (owner). */
export function useLoyaltyAccess() {
  const { hasPermission } = usePermission();
  return {
    canRead: hasPermission(permissions.loyalty.read),
    canApply: hasPermission(permissions.loyalty.apply),
    canWrite: hasPermission(permissions.loyalty.write),
  };
}

type ListParams = ServerListParams & { is_active?: string };

export function useLoyaltyOverview(enabled = true, days?: number) {
  return useQuery({
    queryKey: loyaltyKeys.overview(days),
    queryFn: () => loyaltyService.overview(days, true),
    enabled,
    retry: false,
  });
}

export function useLoyaltyCampaigns(params?: ListParams, enabled = true) {
  return useQuery({
    queryKey: loyaltyKeys.campaigns(params),
    queryFn: () => loyaltyService.listCampaigns(params),
    enabled,
  });
}

export function useLoyaltyPackages(params?: ListParams, enabled = true) {
  return useQuery({
    queryKey: loyaltyKeys.packages(params),
    queryFn: () => loyaltyService.listPackages(params),
    enabled,
  });
}

export function useLoyaltyPlans(params?: ListParams, enabled = true) {
  return useQuery({
    queryKey: loyaltyKeys.plans(params),
    queryFn: () => loyaltyService.listPlans(params),
    enabled,
  });
}

export function useCustomerPackages(
  params?: ServerListParams & { customer_uuid?: string; state?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: loyaltyKeys.customerPackages(params),
    queryFn: () => loyaltyService.listCustomerPackages(params),
    enabled,
  });
}

export function useCustomerPackage(uuid: string) {
  return useQuery({
    queryKey: loyaltyKeys.customerPackage(uuid),
    queryFn: () => loyaltyService.getCustomerPackage(uuid),
    enabled: Boolean(uuid),
  });
}

export function useSubscriptions(
  params?: ServerListParams & {
    customer_uuid?: string;
    state?: string;
    due_within_days?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: loyaltyKeys.subscriptions(params),
    queryFn: () => loyaltyService.listSubscriptions(params),
    enabled,
  });
}

export function useSubscription(uuid: string) {
  return useQuery({
    queryKey: loyaltyKeys.subscription(uuid),
    queryFn: () => loyaltyService.getSubscription(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCustomerLoyalty(customerUuid: string, enabled = true) {
  return useQuery({
    queryKey: loyaltyKeys.customer(customerUuid),
    queryFn: () => loyaltyService.customerLoyalty(customerUuid),
    enabled: enabled && Boolean(customerUuid),
    retry: false,
  });
}

export function useJobLoyalty(jobUuid: string, enabled = true) {
  return useQuery({
    queryKey: loyaltyKeys.job(jobUuid),
    queryFn: () => loyaltyService.jobLoyalty(jobUuid),
    enabled: enabled && Boolean(jobUuid),
    retry: false,
  });
}

export function useLoyaltyMutations() {
  const qc = useQueryClient();
  const { t } = useLocale();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: loyaltyKeys.all });
  };
  const refreshMoney = () => {
    refresh();
    void qc.invalidateQueries({ queryKey: ["finance"] });
    void qc.invalidateQueries({ queryKey: ["tenant", "cari"] });
  };
  const fail = (err: Error) =>
    toast.error(err.message || t("loyalty.errors.generic"));
  const ok = (key: string) => () => {
    refresh();
    toast.success(t(key));
  };

  return {
    createCampaign: useMutation({
      mutationFn: (body: CampaignInput) => loyaltyService.createCampaign(body),
      onSuccess: ok("loyalty.toasts.saved"),
      onError: fail,
    }),
    updateCampaign: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: CampaignInput }) =>
        loyaltyService.updateCampaign(uuid, body),
      onSuccess: ok("loyalty.toasts.saved"),
      onError: fail,
    }),
    deleteCampaign: useMutation({
      mutationFn: (uuid: string) => loyaltyService.deleteCampaign(uuid),
      onSuccess: ok("loyalty.toasts.archived"),
      onError: fail,
    }),
    createPackage: useMutation({
      mutationFn: (body: PackageInput) => loyaltyService.createPackage(body),
      onSuccess: ok("loyalty.toasts.saved"),
      onError: fail,
    }),
    updatePackage: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: PackageInput }) =>
        loyaltyService.updatePackage(uuid, body),
      onSuccess: ok("loyalty.toasts.saved"),
      onError: fail,
    }),
    deletePackage: useMutation({
      mutationFn: (uuid: string) => loyaltyService.deletePackage(uuid),
      onSuccess: ok("loyalty.toasts.archived"),
      onError: fail,
    }),
    createPlan: useMutation({
      mutationFn: (body: PlanInput) => loyaltyService.createPlan(body),
      onSuccess: ok("loyalty.toasts.saved"),
      onError: fail,
    }),
    updatePlan: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: PlanInput }) =>
        loyaltyService.updatePlan(uuid, body),
      onSuccess: ok("loyalty.toasts.saved"),
      onError: fail,
    }),
    deletePlan: useMutation({
      mutationFn: (uuid: string) => loyaltyService.deletePlan(uuid),
      onSuccess: ok("loyalty.toasts.archived"),
      onError: fail,
    }),
    sellPackage: useMutation({
      mutationFn: (body: {
        package_uuid: string;
        customer_uuid: string;
        method: PaymentMethod;
        finance_account_uuid?: string | null;
        notes?: string;
      }) => loyaltyService.sellPackage(body),
      onSuccess: () => {
        refreshMoney();
        toast.success(t("loyalty.toasts.package_sold"));
      },
      onError: fail,
    }),
    cancelCustomerPackage: useMutation({
      mutationFn: (uuid: string) => loyaltyService.cancelCustomerPackage(uuid),
      onSuccess: (res) => {
        refreshMoney();
        toast.success(
          t(
            res.refunded
              ? "loyalty.toasts.package_refunded"
              : "loyalty.toasts.package_cancelled",
          ),
        );
      },
      onError: fail,
    }),
    startSubscription: useMutation({
      mutationFn: (body: {
        plan_uuid: string;
        customer_uuid: string;
        vehicle_uuid?: string | null;
        start_date?: string | null;
        notes?: string;
        payment?: PaymentInput | null;
      }) => loyaltyService.startSubscription(body),
      onSuccess: () => {
        refreshMoney();
        toast.success(t("loyalty.toasts.subscription_started"));
      },
      onError: fail,
    }),
    paySubscription: useMutation({
      mutationFn: ({ uuid, body }: { uuid: string; body: PaymentInput }) =>
        loyaltyService.paySubscription(uuid, body),
      onSuccess: () => {
        refreshMoney();
        toast.success(t("loyalty.toasts.payment_recorded"));
      },
      onError: fail,
    }),
    cancelSubscription: useMutation({
      mutationFn: (uuid: string) => loyaltyService.cancelSubscription(uuid),
      onSuccess: ok("loyalty.toasts.subscription_cancelled"),
      onError: fail,
    }),
    apply: useMutation({
      mutationFn: ({
        jobUuid,
        body,
      }: {
        jobUuid: string;
        body: { kind: LoyaltyKind; source_uuid: string; line_uuid: string };
      }) => loyaltyService.applyToJob(jobUuid, body),
      onSuccess: () => {
        refresh();
        void qc.invalidateQueries({ queryKey: ["tenant", "jobs"] });
        toast.success(t("loyalty.toasts.applied"));
      },
      onError: fail,
    }),
    revert: useMutation({
      mutationFn: ({
        jobUuid,
        applicationUuid,
      }: {
        jobUuid: string;
        applicationUuid: string;
      }) => loyaltyService.revertOnJob(jobUuid, applicationUuid),
      onSuccess: () => {
        refresh();
        void qc.invalidateQueries({ queryKey: ["tenant", "jobs"] });
        toast.success(t("loyalty.toasts.reverted"));
      },
      onError: fail,
    }),
  };
}
