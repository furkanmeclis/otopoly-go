"use client";

import { useQuery } from "@tanstack/react-query";

import type { ServerListParams } from "@/components/entity";
import {
  catalogService,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogService,
  type CatalogSummary,
  type ListPage,
} from "@/features/catalog/services/catalog.service";
import type { ResourceMeta } from "@/features/io/types";

export const catalogQueryKeys = {
  all: ["tenant", "catalog"] as const,
  summary: () => [...catalogQueryKeys.all, "summary"] as const,
  productsMeta: () => [...catalogQueryKeys.all, "products", "meta"] as const,
  productsList: (params?: unknown) =>
    [...catalogQueryKeys.all, "products", "list", params] as const,
  productDetail: (uuid: string) =>
    [...catalogQueryKeys.all, "products", "detail", uuid] as const,
  servicesMeta: () => [...catalogQueryKeys.all, "services", "meta"] as const,
  servicesList: (params?: unknown) =>
    [...catalogQueryKeys.all, "services", "list", params] as const,
  serviceDetail: (uuid: string) =>
    [...catalogQueryKeys.all, "services", "detail", uuid] as const,
  categoriesMeta: () =>
    [...catalogQueryKeys.all, "categories", "meta"] as const,
  categoriesList: (params?: unknown) =>
    [...catalogQueryKeys.all, "categories", "list", params] as const,
  categoryDetail: (uuid: string) =>
    [...catalogQueryKeys.all, "categories", "detail", uuid] as const,
};

export function useCatalogSummary() {
  return useQuery<CatalogSummary>({
    queryKey: catalogQueryKeys.summary(),
    queryFn: () => catalogService.summary(),
  });
}

export function useCatalogProductsMeta() {
  return useQuery<ResourceMeta>({
    queryKey: catalogQueryKeys.productsMeta(),
    queryFn: () => catalogService.productsMeta(),
  });
}

export function useCatalogProducts(
  params?: ServerListParams & {
    category_uuid?: string;
    stock_status?: string;
    is_active?: string;
    track_stock?: string;
    unit?: string;
  },
) {
  return useQuery<ListPage<CatalogProduct>>({
    queryKey: catalogQueryKeys.productsList(params),
    queryFn: () => catalogService.listProducts(params),
  });
}

export function useCatalogProduct(uuid: string) {
  return useQuery<CatalogProduct>({
    queryKey: catalogQueryKeys.productDetail(uuid),
    queryFn: () => catalogService.getProduct(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCatalogServicesMeta() {
  return useQuery<ResourceMeta>({
    queryKey: catalogQueryKeys.servicesMeta(),
    queryFn: () => catalogService.servicesMeta(),
  });
}

export function useCatalogServices(
  params?: ServerListParams & {
    category_uuid?: string;
    is_active?: string;
  },
) {
  return useQuery<ListPage<CatalogService>>({
    queryKey: catalogQueryKeys.servicesList(params),
    queryFn: () => catalogService.listServices(params),
  });
}

export function useCatalogServiceDetail(uuid: string) {
  return useQuery<CatalogService>({
    queryKey: catalogQueryKeys.serviceDetail(uuid),
    queryFn: () => catalogService.getService(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCatalogCategoriesMeta() {
  return useQuery<ResourceMeta>({
    queryKey: catalogQueryKeys.categoriesMeta(),
    queryFn: () => catalogService.categoriesMeta(),
  });
}

export function useCatalogCategory(uuid: string) {
  return useQuery<CatalogCategory>({
    queryKey: catalogQueryKeys.categoryDetail(uuid),
    queryFn: () => catalogService.getCategory(uuid),
    enabled: Boolean(uuid),
  });
}

export function useCatalogCategories(params?: {
  kind?: string;
  is_active?: string;
  q?: string;
}) {
  return useQuery<{ items: CatalogCategory[] }>({
    queryKey: catalogQueryKeys.categoriesList(params),
    queryFn: () => catalogService.listCategories(params),
  });
}
