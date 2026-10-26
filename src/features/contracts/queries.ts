/** React Query hooks for contracts (web `features/contracts/hooks/use-contracts.ts`). */
import { useQuery } from '@tanstack/react-query';

import { qk, useInfiniteList } from '@/features/queries';

import { contractsService } from './services/contracts.service';

export const contractKeys = {
  all: qk.contracts,
  templates: [...qk.contracts, 'templates'] as const,
  instances: [...qk.contracts, 'instances'] as const,
  presets: [...qk.contracts, 'tenant-presets'] as const,
};

type Params = Record<string, string | number | undefined>;

export const useContractInstancesInfinite = (params: Params, enabled = true) =>
  useInfiniteList(contractKeys.instances, (p) => contractsService.listInstances(p as never), params, enabled);

/** Contracts on a customer's service jobs (`customer_uuid` filter), newest first. */
export const useCustomerContracts = (customerUuid: string, enabled = true) =>
  useQuery({
    queryKey: [...contractKeys.instances, 'customer', customerUuid],
    queryFn: () => contractsService.listInstances({ customer_uuid: customerUuid, limit: 20, offset: 0 }),
    enabled: enabled && Boolean(customerUuid),
  });

export const useContractInstance = (uuid: string) =>
  useQuery({
    queryKey: [...contractKeys.instances, 'detail', uuid],
    queryFn: () => contractsService.getInstance(uuid),
    enabled: Boolean(uuid),
  });

export const useContractTemplatesInfinite = (params: Params, enabled = true) =>
  useInfiniteList(contractKeys.templates, (p) => contractsService.listTemplates(p as never), params, enabled);

/** Active templates for the "new contract" picker (web: `is_active=true`, limit 100). */
export const useActiveContractTemplates = (enabled = true) =>
  useQuery({
    queryKey: [...contractKeys.templates, 'active-options'],
    queryFn: () => contractsService.listTemplates({ is_active: 'true', limit: 100, offset: 0 }),
    enabled,
  });

export const useContractTemplate = (uuid: string) =>
  useQuery({
    queryKey: [...contractKeys.templates, 'detail', uuid],
    queryFn: () => contractsService.getTemplate(uuid),
    enabled: Boolean(uuid),
  });

/** Platform presets a tenant owner can clone (web ClonePresetDialog). */
export const useTenantContractPresets = (enabled = true) =>
  useQuery({
    queryKey: [...contractKeys.presets, { limit: 100 }],
    queryFn: () => contractsService.listPresets({ limit: 100, offset: 0 }),
    enabled,
    retry: false,
  });
