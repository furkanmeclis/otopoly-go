"use client";

import { useParams } from "next/navigation";

import { ContractPresetFormPage } from "@/features/contract-presets";

export default function Page() {
  const params = useParams<{ uuid: string }>();
  return <ContractPresetFormPage uuid={String(params.uuid ?? "")} />;
}
