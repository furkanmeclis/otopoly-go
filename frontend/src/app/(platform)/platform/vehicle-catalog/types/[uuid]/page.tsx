import { CatalogTypeDetailPage } from "@/features/vehicle-catalog";

type PageProps = {
  params: Promise<{ uuid: string }>;
};

export default async function PlatformCatalogTypeDetailPage({
  params,
}: PageProps) {
  const { uuid } = await params;
  return <CatalogTypeDetailPage uuid={uuid} />;
}
