import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  dailySummaryService,
  type DailySummaryInput,
} from "@/features/messaging/services/daily-summary.service";

export const dailySummaryKeys = {
  all: ["tenant", "daily-summary"] as const,
  settings: () => [...dailySummaryKeys.all, "settings"] as const,
};

export function useDailySummarySettings(enabled = true) {
  return useQuery({
    queryKey: dailySummaryKeys.settings(),
    queryFn: dailySummaryService.get,
    enabled,
  });
}

export function useSaveDailySummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DailySummaryInput) => dailySummaryService.update(body),
    onSuccess: (data) => {
      queryClient.setQueryData(dailySummaryKeys.settings(), data);
    },
  });
}

export function usePreviewDailySummary() {
  return useMutation({ mutationFn: dailySummaryService.preview });
}

export function useSendTestDailySummary() {
  return useMutation({ mutationFn: dailySummaryService.sendTest });
}
