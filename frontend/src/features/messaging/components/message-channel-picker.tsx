"use client";

import { SmsIcon } from "@/components/icons/sms-icon";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLocale } from "@/providers/locale-provider";

export type MessageChannel = "whatsapp" | "sms";

type MessageChannelPickerProps = {
  id: string;
  value: MessageChannel;
  onChange: (value: MessageChannel) => void;
  /** The organization has an active SMS provider. */
  smsAvailable: boolean;
  disabled?: boolean;
  /** Overrides the default hint under the choice. */
  hint?: string;
};

/** WhatsApp / SMS choice (daily summary, vehicle alerts, contract OTP). */
export function MessageChannelPicker({
  id,
  value,
  onChange,
  smsAvailable,
  disabled,
  hint,
}: MessageChannelPickerProps) {
  const { t } = useLocale();
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <Label htmlFor={id}>{t("messaging.channel_picker.label")}</Label>
      <ToggleGroup
        id={id}
        type="single"
        variant="outline"
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === "whatsapp" || v === "sms") onChange(v);
        }}
      >
        <ToggleGroupItem value="whatsapp" aria-label="WhatsApp">
          <WhatsAppIcon className="size-4 text-[#25D366]" />
          WhatsApp
        </ToggleGroupItem>
        <ToggleGroupItem
          value="sms"
          aria-label="SMS"
          disabled={!smsAvailable && value !== "sms"}
        >
          <SmsIcon className="size-4 text-violet-600" />
          SMS
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-muted-foreground text-xs">
        {hint ??
          (smsAvailable
            ? t("messaging.channel_picker.hint")
            : t("messaging.channel_picker.sms_unavailable"))}
      </p>
    </div>
  );
}
