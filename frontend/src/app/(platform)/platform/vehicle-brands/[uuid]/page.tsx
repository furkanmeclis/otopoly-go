import { VehicleBrandDetailPage } from "@/features/vehicle-brands";

export default async function Page({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  return <VehicleBrandDetailPage uuid={uuid} />;
}
