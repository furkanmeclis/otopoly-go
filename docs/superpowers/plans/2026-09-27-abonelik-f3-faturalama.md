# Abonelik F3 — Faturalama · Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onaylanan her sipariş için `go-ubltr` ile e-Arşiv UBL-TR XML fatura üretmek, XSLT ile HTML'e ve Gotenberg ile PDF'e çevirip storage'a arşivlemek; satıcı ve alıcı (işletme) fatura bilgilerini, fatura numaralandırmayı, admin XSLT yüklemeyi ve fatura listelerini sağlamak.

**Architecture:** Yeni paket `backend/internal/modules/billing/invoice` (saf: sipariş + satıcı + alıcı → `ubltr` Invoice → XML; XSLT → HTML). `billing/usecase/invoices.go` numara alır (satır kilidi), XML'i üretir/doğrular, HTML'i `render.NewHTML(helium.New(), render.Style{Name, Stylesheet})` ile, PDF'i mevcut `internal/platform/pdfrender` (Gotenberg) ile üretir ve storage'a yazar. Onaydan sonra `approveTx` commit'inin ardından `IssueInvoice(orderID)` çağrılır; hata siparişi geri almaz, faturayı `failed` bırakır (admin "yeniden üret").

**Tech Stack:** Go, `github.com/furkanmeclis/go-ubltr` (+ `/render`, `/render/xslt/helium`, go.mod'da ekli), Gotenberg, sqlc; Next.js.

**Spec:** `docs/superpowers/specs/2026-09-27-abonelik-ve-plan-yonetimi-design.md` §0 #6–#8, #11; §3 `billing_invoices`, `billing_invoice_counters`, `billing_settings`, `organizations.invoice_*`; §7; §10; §12. Önceki fazlar: F1, F2 planları (aynı klasör).

## Durum (kesinti durumunda buradan devam)

- [x] Task 1 migration + sorgular
- [x] Task 2 invoice paketi (mapper + render) + testler
- [x] Task 3 usecase (numara, üretim, onay kancası, yeniden üret, iptal) + DB testi
- [x] Task 4 handler/route/OpenAPI
- [x] Task 5 frontend işletme (fatura bilgileri formu + faturalar listesi)
- [x] Task 6 frontend admin (faturalar sayfası + satıcı ayarları + XSLT yükleme)
- [x] Task 7 uçtan uca doğrulama, ekran görüntüleri, Notion

## Global Constraints

- F2'nin tüm kısıtları geçerli (same-origin `/api/v1`, OpenAPI + `pnpm api:generate`, tutarlar string, Europe/Istanbul, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Migration `000066`.
- Profil `EARSIVFATURA`, tip `SATIS`, para `TRY`, KDV oranı `billing_settings.vat_rate` (varsayılan 20). Fiyatlar KDV **dahil**; faturada matrah = `tutar / (1+oran)`, 2 hane.
- Numara: `{invoice_series}{yıl}{9 haneli sıra}` → `TWD2026000000001` (16 karakter). Sayaç `billing_invoice_counters (series, year)` satırında `SELECT … FOR UPDATE` ile artar; iptal edilen numara tekrar kullanılmaz.
- Fatura UUID: `gen_random_uuid()` (UBL `cbc:UUID`).
- Alıcı: işletmenin `invoice_tax_id` 10 hane → VKN (tüzel, `invoice_name` unvan, `invoice_tax_office`); 11 hane → TCKN (şahıs; ad/soyad = `invoice_name` son boşluktan bölünür). Boşsa **nihai tüketici**: TCKN `11111111111`, ad = işletme adı, adres = işletme adresi/şehir veya `"-"`.
- Kalemler sipariş `lines`'ından: `plan` kalemi fatura satırı (miktar 1, birim fiyat = KDV hariç liste fiyatı); `proration`, `discount`, `credit` kalemleri **satır üstü indirim** (`cac:AllowanceCharge ChargeIndicator=false`, gerekçe metni = kalem etiketi) — spec #5. Toplam, siparişin `total`'ı ile kuruşu kuruşuna eşleşmeli (yuvarlama farkı son indirime yazılır).
- `total == 0` siparişe fatura **üretilmez** (0 TL e-Arşiv kesilmez).
- XSLT: `billing_settings.xslt_object_key` boşsa gömülü `invoice/assets/general.xslt` (repoda mevcut). Admin tek `.xslt/.xsl` dosyası yükler (≤ 2 MB); yüklemeden önce örnek faturayla render denenir, hata verirse reddedilir (`422 XSLT_INVALID`). XSLT ayrıca XML'e `cac:AdditionalDocumentReference` ile base64 gömülür (GİB görüntüleyici uyumu).
- Storage anahtarları: `billing/invoices/{year}/{number}.xml`, `.pdf`; XSLT `billing/xslt/{unix}.xslt`. Dosyalar yalnızca API stream'iyle servis edilir.
- İzinler: tenant `tenant.billing.read` (liste, PDF), `tenant.billing.write` (fatura bilgileri PUT); platform `platform.billing.read` (liste/XML/PDF), `platform.billing.write` (yeniden üret, iptal), `platform.billing.settings` (satıcı + XSLT).
- Hata kodları: `XSLT_INVALID` (422), `INVOICE_STATE` (409), `INVOICE_PROFILE_INVALID` (422; VKN/TCKN hane/sağlama).

## Review Focus

1. **Kuruş eşleşmesi:** 14.580,00 TL (16.200 − 1.620 indirim) → matrah 12.150,00, KDV 2.430,00, ödenecek 14.580,00; XML `LegalMonetaryTotal/PayableAmount` = sipariş `total`. Task 2 `TestMapTotalsMatchOrder`.
2. **Nihai tüketici fallback:** fatura bilgisi girilmemiş işletme → TCKN 11111111111. Task 2 `TestBuyerFallback`.
3. **Bozuk XSLT:** geçersiz XSLT yüklemesi 422, mevcut XSLT değişmez. Task 3 DB testi.
4. **PDF servisi kapalı:** Gotenberg erişilemezse XML yine kaydedilir, fatura `issued` + `pdf_object_key` boş, admin "PDF'i yeniden üret" yapabilir. Task 3 testi (fake renderer hata döner).
5. **Eş zamanlı numara:** iki paralel üretim aynı numarayı almamalı. Task 3 DB testi (iki goroutine).

---

## API sözleşmesi

```jsonc
// InvoiceProfile (işletme fatura bilgileri)
{ "invoice_name": "", "invoice_tax_id": "", "invoice_tax_office": "", "invoice_address": "", "invoice_city": "", "invoice_email": "" }

// Invoice
{ "uuid", "number": "TWD2026000000001", "issue_date": "2026-09-27",
  "status": "issued" | "failed" | "voided",
  "order_uuid", "order_reference": "OTO-…",
  "buyer": { "name", "tax_id", "tax_office", "is_final_consumer": true },
  "subtotal": "13500.00", "discount_total": "1350.00", "vat_total": "2430.00", "grand_total": "14580.00",
  "has_xml": true, "has_pdf": true, "error": "", "created_at",
  "organization": { "uuid", "slug", "name" } | null }  // yalnız platform

// SellerSettings
{ "seller_name", "seller_tax_id", "seller_tax_office", "seller_address", "seller_city", "seller_email", "seller_phone", "seller_website", "invoice_series": "TWD", "xslt": { "custom": false, "uploaded_at": null } }
```

| Metot | Yol | İzin | Cevap |
|---|---|---|---|
| GET | `/v1/tenant/billing/invoice-profile` | read | `InvoiceProfile` |
| PUT | `/v1/tenant/billing/invoice-profile` | write | `InvoiceProfile` · 422 `INVOICE_PROFILE_INVALID` |
| GET | `/v1/tenant/billing/invoices` | read | liste `Invoice` |
| GET | `/v1/tenant/billing/invoices/{uuid}/pdf` | read | PDF stream (404 yoksa) |
| GET | `/v1/platform/billing/invoices` | read | liste (`?status=&q=&limit&offset`) |
| GET | `/v1/platform/billing/invoices/{uuid}/xml` · `/pdf` | read | dosya stream |
| POST | `/v1/platform/billing/invoices/{uuid}/regenerate` | write | `Invoice` (XML yoksa XML+PDF, varsa yalnız PDF) |
| POST | `/v1/platform/billing/invoices/{uuid}/void` | write | `Invoice` · 409 `INVOICE_STATE` |
| POST | `/v1/platform/billing/orders/{uuid}/invoice` | write | `Invoice` (onaylı ama faturasız sipariş için elle üret) |
| GET/PUT | `/v1/platform/billing/seller` | read/settings | `SellerSettings` |
| POST | `/v1/platform/billing/seller/xslt` | settings | multipart `file` → `SellerSettings` · 422 `XSLT_INVALID` |
| DELETE | `/v1/platform/billing/seller/xslt` | settings | varsayılana dön → `SellerSettings` |

`Order` şemasına `invoice_uuid: string|null` eklenir.

---

### Task 1: Migration 000066 + sorgular
- `organizations` + `invoice_name, invoice_tax_id, invoice_tax_office, invoice_address, invoice_city, invoice_email` (VARCHAR/TEXT, `NOT NULL DEFAULT ''`).
- `billing_invoice_counters (series VARCHAR(3), year INT, last_no BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(series, year))`.
- `billing_invoices`: `id, uuid (unique), organization_id FK, order_id FK UNIQUE, number VARCHAR(16) UNIQUE, issue_date DATE, profile, type, buyer JSONB, seller JSONB, lines JSONB, subtotal, discount_total, vat_total, grand_total NUMERIC(18,2), xml_object_key, pdf_object_key, xslt_version VARCHAR(40), status CHECK (issued|failed|voided), error TEXT, voided_at, voided_by, created_at, updated_at` + updated_at trigger + `idx (organization_id, created_at DESC)`.
- `billing_settings` + `xslt_uploaded_at TIMESTAMPTZ NULL`.
- Sorgular `queries/billing_invoices.sql`: `NextInvoiceNumber :one` (upsert + `UPDATE … SET last_no = last_no+1 RETURNING last_no` tek ifade), `CreateInvoice`, `UpdateInvoiceFiles`, `SetInvoiceStatus`, `GetInvoiceByUUID(ForOrg)`, `GetInvoiceByOrder`, `ListInvoicesForOrg`+count, `ListInvoices`+count (platform, q = numara/işletme), `GetInvoiceProfile`, `UpdateInvoiceProfile`, `GetSellerSettings`, `UpdateSellerSettings`, `SetXSLT`.
- Commit: `feat(billing): invoice schema, counters and invoice profile columns`.

### Task 2: `billing/invoice` paketi
- `mapper.go`: `type Party{Name, TaxID, TaxOffice, Address, City, Email, Phone, Website}`, `type Line{Kind, Label, Amount string}`, `type Input{UUID, Number string; IssueAt time.Time; Seller, Buyer Party; Lines []Line; VATRate int; OrderRef string; XSLT []byte}`, `func Build(in Input) (xml []byte, totals Totals, err error)` — `builder.NewInvoiceBuilder()` ile; `ubltr.Marshal`, `ubltr.ValidateXSD`. `Totals{Subtotal, DiscountTotal, VATTotal, GrandTotal string}`. `func BuyerFromProfile(orgName, orgAddress, orgCity string, p Profile) Party` (VKN/TCKN/nihai tüketici kuralı), `func ValidateTaxID(s string) error` (VKN 10 hane sağlama algoritması, TCKN 11 hane algoritması).
- `render.go`: `//go:embed assets/general.xslt`, `func DefaultXSLT() []byte`, `func RenderHTML(ctx, xml, xslt []byte) ([]byte, error)` (`render.NewHTML(helium.New(), render.Style{Name:"invoice", Stylesheet: xslt})`), `func SampleXML() []byte` (XSLT doğrulaması için sabit örnek; Build ile üretilmiş).
- Testler: `TestMapTotalsMatchOrder` (Review Focus 1 rakamları), `TestBuyerFallback`, `TestBuyerVKNvsTCKN`, `TestValidateTaxID` (geçerli/geçersiz örnekler), `TestRenderDefaultXSLT` (HTML fatura numarasını içerir), `TestXSDValid`.
- Commit: `feat(billing): UBL-TR e-Arşiv invoice mapper and XSLT renderer`.

### Task 3: usecase
- `invoices.go`: `IssueInvoice(ctx, orderID) (Invoice, error)` (idempotent: varsa döner; `total==0` → `nil, nil`), numara, `invoice.Build`, XML storage, `RenderHTML` → `pdfrender` → PDF storage (PDF hatası → `issued` + `error` notu, pdf boş), `RegenerateInvoice`, `VoidInvoice`, `ListInvoicesForOrg/Admin`, `OpenInvoiceFile(uuid, kind, platform)`, `GetInvoiceProfile/UpdateInvoiceProfile`, `GetSellerSettings/UpdateSellerSettings`, `UploadXSLT` (örnek XML ile render dene → hata 422), `ResetXSLT`.
- `approve.go`: commit sonrası `go`suz (senkron, ama hatası loglanır ve yutulur) `IssueInvoice`; `CreateOrder` 0 TL otomatik onayında fatura yok. Elle abonelikte fatura yok (spec: isteğe bağlı → F3 kapsamı dışı, not).
- PDF renderer seam: `type PDFRenderer interface{ HTMLToPDF(ctx, html []byte) ([]byte, error) }`; `server.go`/worker'da mevcut Gotenberg istemcisine bağlanır; nil ise PDF atlanır.
- DB testi `invoices_db_test.go`: onay → fatura `issued`, numara formatı, XML storage'da; fake PDF hatası → `issued` + `has_pdf=false`, regenerate → PDF var; void → `voided`, tekrar void → `INVOICE_STATE`; iki paralel `NextInvoiceNumber` farklı; bozuk XSLT → `XSLT_INVALID`.
- Commit: `feat(billing): invoice issuing on approval with XML/PDF archive, XSLT management`.

### Task 4: handler/route/OpenAPI
- Tablo uçları; stream'lerde `Content-Type` (`application/xml`, `application/pdf`), `Content-Disposition: inline; filename="{number}.pdf"`, `Cache-Control: private, no-store`. Multipart XSLT ≤ 2 MB.
- OpenAPI şemaları: `BillingInvoice`, `BillingInvoiceList`, `BillingInvoiceProfile`, `BillingSellerSettings` + Envelope; `BillingOrder.invoice_uuid`. Tüm operasyonlara 401/403.
- `make openapi-lint` temiz, `pnpm api:generate`.
- Commit: `feat(billing): invoice, invoice profile and seller endpoints with OpenAPI`.

### Task 5: Frontend işletme
- Abonelik sayfasına iki kart: **Fatura bilgileri** (unvan/ad soyad, VKN/TCKN, vergi dairesi, adres, şehir, e-posta; boşsa "Nihai tüketici adına kesilir" notu; `canWrite` yoksa salt okunur) ve **Faturalar** (numara, tarih, tutar, durum, "PDF" bağlantısı `/api/v1/tenant/billing/invoices/{uuid}/pdf`).
- Sipariş geçmişinde onaylı siparişe fatura bağlantısı (`invoice_uuid`).
- Commit: `feat(billing): tenant invoice profile and invoices`.

### Task 6: Frontend admin
- `/platform/billing/invoices`: tablo (numara, işletme, tarih, tutar, durum), satır aksiyonları XML / PDF / Yeniden üret / İptal (onaylı).
- Ödeme ayarları sayfasına **Satıcı bilgileri** kartı (seller alanları + seri) ve **Fatura şablonu (XSLT)** kartı (durum: varsayılan / özel + yükleme tarihi, dosya yükle, varsayılana dön).
- Nav: "Faturalar" öğesi (`FileText`).
- Commit: `feat(billing): platform invoices, seller settings and XSLT upload`.

### Task 7: Doğrulama
- `go test ./...` (DB), lint, tsc/eslint; tarayıcıda satıcı bilgisi gir → işletme fatura bilgisi gir → sipariş → onay → fatura PDF açılır (GİB görünümü) → XML indir; özel XSLT yükle/geri al.
- Ekran görüntüleri + Notion F3 bölümü (araç/yazar notu olmadan). Push.
