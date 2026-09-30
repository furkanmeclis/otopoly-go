# Documents area port report (contracts / exports / imports)

## Routes built

| Web page | Mobile file |
|---|---|
| `contracts/page.tsx` (`ContractInstancesPage`) | `src/app/(app)/contracts/index.tsx` |
| `contracts/instances/[uuid]` (`ContractInstanceDetailPage` + `SignDialog`/`SignerSignForm`) | `src/app/(app)/contracts/instances/[id].tsx` |
| `contracts/templates/page.tsx` (`ContractTemplatesPage` + `ClonePresetDialog`) | `src/app/(app)/contracts/templates/index.tsx` |
| `contracts/templates/[uuid]` (`ContractTemplateDetailPage`) | `src/app/(app)/contracts/templates/[id].tsx` |
| `exports/page.tsx` + `[uuid]` | `src/app/(app)/exports/index.tsx`, `[id].tsx` |
| `imports/page.tsx` + `[uuid]` | `src/app/(app)/imports/index.tsx`, `[id].tsx` |

Every screen has a permission guard, pull-to-refresh, a loading skeleton, an `ErrorState` with retry, an `EmptyState`, and infinite scroll on lists.

### Contracts
- **List:** search (`q`), status chips (all/draft/pending/executed/voided) like the web tabs, and the fields number, title, subject, status, signed/total signers and created time. The templates shortcut and "new contract" button (`tenant.contracts.write`) are in the header. The create sheet picks an active template and an in-progress job, matching the web `CreateInstanceDialog`. `?job_uuid=` pre-fills and locks the job, then opens the sheet. `FEATURE_DISABLED` shows a locked state.
- **Detail:** status, created/executed/voided times, `pdf_error`, signers (role, required, OTP state, sign button) and a preview card with the rendered `content_html`.
  - The gallery lists media, with delete while the contract is open.
  - **Download PDF** runs when the contract is executed. It uses `contractsService.downloadPdf` → `downloadAndShare`.
  - **Void** is owner-only and asks for confirmation.
  - **Finalize** (`POST …/finalize`) is a mobile addition. It shows only for pending contracts that need no signature. The web detail page has no button for it, but the service has the call.
- **Signing:** `features/contracts/components/sign-sheet.tsx` follows the web `SignerSignForm` exactly:
  - The WhatsApp OTP step (customer signer with `otp_required`) shows the contract summary and KVKK notice, a phone field, send/resend with a countdown, and a 6-digit code to verify.
  - The signing step takes a display name (pre-filled), a finger signature pad and the disclaimer. If the server returns `OTP_REQUIRED`, the form goes back to the OTP step.
- **Signature pad:** `react-native-svg` plus responder props, with no new dependency.
  - The PNG is produced in plain JS (`features/contracts/lib/signature-png.ts`): a 1-bit palette PNG with a transparent background and stored-deflate blocks, sent as a `data:image/png;base64,…` URL like the web.
  - I checked the output with Python zlib/CRC checks and by viewing the image.
- **Templates list:** search, active/passive chips, sort by title. The owner-only actions (`canManage` = owner + `contracts.write`, like the web) are "blank template" (same payload as the web) and "copy from preset". The copy sheet lists tenant presets and falls back to typing a preset UUID when listing presets is forbidden, matching the web i18n.
- **Template detail (decision):** the web edits the body in a Lexical rich-text editor. On mobile the body is a **read-only preview** (`ContractHtml`, a small HTML renderer with no WebView) with a note that body editing is on the web.
  - Owners can edit title, description, the signature/OTP/active switches and the signer slots (port of `SignerSlotsEditor`), and can delete the template.
  - PATCH leaves out the content fields, so the backend (pointer fields) keeps the body unchanged. Non-owners see a read-only view.

### Exports
- **List:** resource, format, status badge, row count, created time, and a download button on completed jobs. While any job is pending or processing, the list polls every 2.5 s.
- **Detail:** summary (uuid, resource, format, status, rows, created, filename), an error section, and a download section. It polls while the job is running.
- **New export sheet (mobile addition):** the web starts exports from `ExportMenu` on each resource page; the mobile resource screens don't have that yet, so the jobs screen has a "new export" sheet.
  - You pick a resource (only those you have the export permission for, per the web `EXPORT_PERM`), a format (pdf/xlsx/csv/json) and optional filters: `q` and `date_from`/`date_to`, which the backend whitelists.
  - It posts to the resource's `EXPORT_PATHS` route with `{format, query, locale}`.
  - Catalog resources are not offered: their web path `POST /v1/tenant/exports` has no backend route. `tenant.cari.entries` is per account.
- **Download:** `exportsService.download` → `downloadAndShare` opens the share sheet. The system share sheet / Quick Look stands in for the web's in-page spreadsheet, JSON and PDF previews, which are not ported.

### Imports
- **List and detail:** everything on the web pages — summary, column mapping table (`IMPORT_SCHEMA` + `apiMappingToUi`), default values, preview totals and row errors, error section, and rollback while the 24 h window is open. Rollback is available from the list and from the detail screen.
- **Upload is web-only:** `expo-document-picker` is not installed, so the upload / mapping / preview / confirm wizard is not ported and the list says so. `importsService` still has `updateMapping/preview/confirm/rollback` for later.

## Role gates
- **Contracts:** screens need `tenant.contracts.read`. Create, sign, OTP, media delete and finalize need `tenant.contracts.write`. Template create/clone/edit/delete and void are owner-only (backend `tOwnerWrite`).
- **Exports:** screens need `tenant.finance.export` (backend list/get/download gate). Each resource in the new-export sheet also checks its own `*.export` permission.
- **Imports:** screens are gated `ownerOnly(P.importsRead)` (backend `RequireOrgRole("owner")` + `tenant.imports.read`), in `features/io/lib/gates.ts`.

## Mock routes added
- **`src/api/mock/handlers/contracts.ts`:**
  - `GET templates/meta`, `GET presets`, `GET/POST templates`, `POST templates/clone`, `GET/PATCH/DELETE templates/:uuid`
  - `GET/POST instances`, `GET instances/:uuid`, `POST …/void`, `POST …/finalize`
  - `POST …/signers/:id/otp`, `POST …/otp/verify`, `POST …/sign`
  - `POST …/media`, `DELETE …/media/:id`
  - It follows the backend rules: statuses; owner-only writes; `OTP_REQUIRED` (409), `INVALID_OTP_CODE` (400), `RATE_LIMITED` (429, 60 s resend) and the 30-minute verification window; the contract becomes executed once all required signers have signed; variables are resolved from the job and organization.
  - **The demo OTP code is `123456`.**
  - Seed data per organization, created on first use: 2 presets, 2 templates, and 3 contracts (executed / pending / voided).
- **`src/api/mock/handlers/io.ts`:**
  - `GET /v1/tenant/exports`, `GET …/:uuid`, `GET …/:uuid/download`
  - The 9 tenant `POST …/export` routes, each checking its own permission. Jobs go pending → processing (1.5 s) → completed (4 s), with row counts taken from the demo data.
  - `GET /v1/tenant/imports`, `GET …/:uuid`, `POST …/:uuid/rollback` (owner only). Seeded jobs: 2 applied, 1 failed.
- **State storage:** mock state is stored as `_contracts` / `_io` on the demo DB object. It is persisted with the DB and reset with "reset demo data". The shared files `db.ts`/`seed.ts` are unchanged.
- **Smoke test:** `scripts/smoke/documents.smoke.ts` (20 checks, all passing). The run command is in the file header; it is not wired into `npm run test:mock`.

## New files in owned folders
- `features/contracts/{queries.ts, lib/access.ts, lib/signature-png.ts, components/{contract-html,signature-pad,sign-sheet,signer-slots-editor,contract-sheets}.tsx}`
- `features/io/{queries.ts, use-share-export.ts, services/{exports,imports}.service.ts, lib/{display,export-resources,gates}.ts}`
- Locale files: `locales/mobile/areas/documents.{tr,en}.json`

## Known issues / shared changes requested
- `P` in `features/auth/permissions.ts` has no `suppliersExport` / `purchasesExport`. `export-resources.ts` casts the slugs `tenant.suppliers.export` / `tenant.purchases.export` for now. Please add them to `P`.
- The menu gates `/imports` on `P.importsRead` only. The backend also requires the owner role, so the menu should use `ownerOnly(P.importsRead)`. The screen itself is already guarded.
- The web job detail's `JobContractsSection` (create and sign from the job page) belongs to the jobs area and is not ported here. The jobs screen can link to `/contracts?job_uuid=<uuid>`, which opens the create sheet with that job locked.
- Photo/file upload for contract media is web-only until an image or document picker is added (`expo-image-picker` / `expo-document-picker` need a dev build).
- In demo mode `downloadAndShare` always writes a stub PDF, even for xlsx/csv/json exports. This only affects the mock.

## Verification
- `npx tsc --noEmit`: clean.
- `npx eslint` on all owned files: clean.
- `npm run test:mock`: all passed.
- `node scripts/check-i18n.mjs`: no missing keys in documents files. The remaining missing keys are in the catalog/crm areas, which belong to other agents.
