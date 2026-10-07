"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useParams } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { permissions } from "@/config/permissions";
import { DailySummaryCard } from "@/features/messaging/components/daily-summary-card";
import { MessageTemplatesPanel } from "@/features/messaging/components/message-templates-panel";
import { NotificationRulesCard } from "@/features/messaging/components/notification-rules-card";
import { OutboundLogCard } from "@/features/messaging/components/outbound-log-card";
import { VehicleAlertsCard } from "@/features/messaging/components/vehicle-alerts-card";
import { WhatsAppSessionCard } from "@/features/messaging/components/whatsapp-session-card";
import { useWhatsAppSession } from "@/features/messaging/hooks/use-messaging";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

export function MessagingPage() {
  const { t } = useLocale();
  const params = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { hasPermission } = usePermission();
  const membership = user?.organizations.find(
    (org) => org.slug === String(params.slug ?? ""),
  );
  const canWrite =
    membership?.role === "owner" && hasPermission(permissions.messaging.write);
  const canReadLog = hasPermission(permissions.messaging.read);
  const session = useWhatsAppSession();
  // Until the session loads assume entitled (no notice flash; writes are
  // enforced by the API anyway).
  const ownNumberEntitled = session.data?.own_number_entitled ?? true;
  const [tab, setTab] = useState("connection");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<MessageCircle className="size-7" />}
        title={t("messaging.page.title")}
        description={t("messaging.page.description")}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="connection">
            {t("messaging.tabs.connection")}
          </TabsTrigger>
          <TabsTrigger value="templates">
            {t("messaging.tabs.templates")}
          </TabsTrigger>
          {canReadLog ? (
            <TabsTrigger value="outbound">
              {t("messaging.tabs.outbound")}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="connection" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <WhatsAppSessionCard canWrite={canWrite} />
            <NotificationRulesCard />
            {/* Owner-only: the summary contains revenue and cash balances. */}
            {canWrite ? <VehicleAlertsCard /> : null}
            {canWrite ? <DailySummaryCard /> : null}
          </div>
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <MessageTemplatesPanel
            canWrite={canWrite}
            ownNumberEntitled={ownNumberEntitled}
          />
        </TabsContent>
        {canReadLog ? (
          <TabsContent value="outbound" className="mt-4">
            <OutboundLogCard />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
