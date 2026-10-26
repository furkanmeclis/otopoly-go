import { permissions } from "@/config/permissions";
import { ApnsKeyCard } from "@/features/integrations/apns/components/apns-key-card";
import { OAuthProviderSettingsPage } from "@/features/integrations/oauth/components/oauth-provider-settings-page";

export default function AppleIntegrationPage() {
  return (
    <div className="space-y-6">
      <OAuthProviderSettingsPage
        provider="apple"
        writePermission={permissions.integrations.apple.write}
      />
      <ApnsKeyCard writePermission={permissions.integrations.apple.write} />
    </div>
  );
}
