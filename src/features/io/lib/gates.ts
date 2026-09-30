import { ownerOnly, P } from '@/features/auth/permissions';

/** Backend: tenant import jobs are owner-only (`RequireOrgRole("owner")` + `tenant.imports.read`). */
export const IMPORTS_GATE = ownerOnly(P.importsRead);
