"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { catalogQueryKeys } from "@/features/catalog/hooks/use-catalog-queries";
import {
  catalogService,
  type AdjustStockInput,
  type CreateCategoryInput,
  type CreateProductInput,
  type CreateServiceInput,
  type UpdateCategoryInput,
  type UpdateProductInput,
  type UpdateServiceInput,
} from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";

export function useCatalogMutations() {
  const queryClient = useQueryClient();
  const { t } = useLocale();

  const invalidateCatalog = () => {
    queryClient.invalidateQueries({ queryKey: catalogQueryKeys.all });
  };

  const createProduct = useMutation({
    mutationFn: (body: CreateProductInput) =>
      catalogService.createProduct(body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.products.created_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create product");
    },
  });

  const updateProduct = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: UpdateProductInput }) =>
      catalogService.updateProduct(uuid, body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.products.updated_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update product");
    },
  });

  const adjustStock = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: AdjustStockInput }) =>
      catalogService.adjustProductStock(uuid, body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.products.stock_adjusted_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to adjust stock");
    },
  });

  const deleteProduct = useMutation({
    mutationFn: (uuid: string) => catalogService.deleteProduct(uuid),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.products.deleted_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete product");
    },
  });

  const createService = useMutation({
    mutationFn: (body: CreateServiceInput) =>
      catalogService.createService(body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.services.created_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create service");
    },
  });

  const updateService = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: UpdateServiceInput }) =>
      catalogService.updateService(uuid, body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.services.updated_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update service");
    },
  });

  const deleteService = useMutation({
    mutationFn: (uuid: string) => catalogService.deleteService(uuid),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.services.deleted_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete service");
    },
  });

  const createCategory = useMutation({
    mutationFn: (body: CreateCategoryInput) =>
      catalogService.createCategory(body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.categories.created_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create category");
    },
  });

  const updateCategory = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: UpdateCategoryInput }) =>
      catalogService.updateCategory(uuid, body),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.categories.updated_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update category");
    },
  });

  const deleteCategory = useMutation({
    mutationFn: (uuid: string) => catalogService.deleteCategory(uuid),
    onSuccess: () => {
      invalidateCatalog();
      toast.success(t("catalog.categories.deleted_success"));
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete category");
    },
  });

  return {
    createProduct,
    updateProduct,
    adjustStock,
    deleteProduct,
    createService,
    updateService,
    deleteService,
    createCategory,
    updateCategory,
    deleteCategory,
  };
}
