import { SmsOrgMessagesPage } from "@/features/platform-sms";

export default async function Page({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  return <SmsOrgMessagesPage uuid={uuid} />;
}
