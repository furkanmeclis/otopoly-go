import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  vehicleAlertsService,
  type VehicleAlertInput,
} from "@/features/messaging/services/vehicle-alerts.service";

export const vehicleAlertKeys = {
  all: ["tenant", "vehicle-alerts"] as const,
  settings: () => [...vehicleAlertKeys.all, "settings"] as const,
};

export function useVehicleAlertSettings() {
  return useQuery({
    queryKey: vehicleAlertKeys.settings(),
    queryFn: vehicleAlertsService.get,
  });
}

export function useSaveVehicleAlerts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: VehicleAlertInput) => vehicleAlertsService.update(body),
    onSuccess: (data) => {
      queryClient.setQueryData(vehicleAlertKeys.settings(), data);
    },
  });
}

export function useSendTestVehicleAlert() {
  return useMutation({ mutationFn: vehicleAlertsService.sendTest });
}
