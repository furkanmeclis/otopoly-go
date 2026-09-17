"use client";

import { MessageCircle } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { NotificationRulesCard } from "@/features/messaging/components/notification-rules-card";
import { WhatsAppSessionCard } from "@/features/messaging/components/whatsapp-session-card";

export function MessagingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        icon={<MessageCircle className="size-7" />}
        title="Mesajlaşma"
        description="WhatsApp bağlantısını ve otomatik bildirim kurallarını yönetin."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <WhatsAppSessionCard />
        <NotificationRulesCard />
      </div>
    </div>
  );
}
