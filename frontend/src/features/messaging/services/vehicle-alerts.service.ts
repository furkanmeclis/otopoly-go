import { platformRequest } from "@/lib/api/platform-request";

export type VehicleAlertEvent = "created" | "ready" | "delivered" | "cancelled";

export const VEHICLE_ALERT_EVENTS: VehicleAlertEvent[] = [
  "created",
  "ready",
  "delivered",
  "cancelled",
];

export const VEHICLE_ALERT_BATCH_OPTIONS = [0, 30, 60] as const;

export type VehicleAlertMember = {
  uuid: string;
  name: string;
  email: string;
  role: "owner" | "staff" | string;
  has_phone: boolean;
  has_push: boolean;
};

export type VehicleAlertSettings = {
  enabled: boolean;
  events: VehicleAlertEvent[];
  /** Empty = every service. */
  service_uuids: string[];
  recipient_user_uuids: string[];
  /** 0 = instant; otherwise one WhatsApp digest per window (minutes). */
  batch_minutes: number;
  whatsapp_connected: boolean;
  members: VehicleAlertMember[];
  services: { uuid: string; name: string }[];
};

export type VehicleAlertInput = {
  enabled: boolean;
  events: VehicleAlertEvent[];
  service_uuids: string[];
  recipient_user_uuids: string[];
  batch_minutes: number;
};

export const vehicleAlertsService = {
  get() {
    return platformRequest<VehicleAlertSettings>(
      "GET",
      "/v1/tenant/vehicle-alerts",
    );
  },
  update(body: VehicleAlertInput) {
    return platformRequest<VehicleAlertSettings>(
      "PUT",
      "/v1/tenant/vehicle-alerts",
      { body },
    );
  },
  sendTest() {
    return platformRequest<{
      in_app: number;
      whatsapp: number;
      skipped: string[];
    }>("POST", "/v1/tenant/vehicle-alerts/test");
  },
};
