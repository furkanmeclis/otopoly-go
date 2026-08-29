"use client";

import { PublicAuthShell } from "@/features/auth/components/public-auth-shell";
import { OrganizationRegisterForm } from "@/features/organizations/components/organization-register-form";

export default function RegisterPage() {
  return (
    <PublicAuthShell>
      <OrganizationRegisterForm />
    </PublicAuthShell>
  );
}
