# Abonelik ve Plan Yönetimi — Tasarım Dokümanı
*2026-09-27 · Durum: onaylandı (açık noktalar kapatıldı)*

---

## 0. Amaç ve karar özeti

Otopoly'yi SaaS abonelik modeline taşımak: birden fazla plan, aylık/yıllık fiyat, planlara bağlı ve sistemde **uygulanan** limitler, indirim kodları, havale/EFT ile self-servis satın alma, admin onayı, `go-ubltr` ile e-Arşiv fatura kaydı ve admin tarafında abonelik takibi.

Soru-cevapta alınan kararlar (değişmez kabul edilir):

| # | Konu | Karar |
|---|------|-------|
| 1 | Satış modeli | Self-servis havale akışı ana yol; admin elle abonelik tanımlayabilir ve süre uzatabilir |
| 2 | Dekont | İşletme ödeme bildiriminde dekont (PDF/görsel) yükler; admin onay ekranında görür |
| 3 | Limit davranışı | Her limit için admin **sert/yumuşak** seçer ve **tolerans yüzdesi** girer; uyarı eşiği (varsayılan %80) limit bazında ayarlanır |
| 4 | Süre bitimi | **Ek süre** (admin ayarı, varsayılan 3 gün) boyunca tam kullanım + kırmızı uyarı; sonra **salt okunur** mod |
| 5 | Plan değişikliği | **Kıst hesap**: kalan sürenin bedeli yeni fiyattan düşülür; ödeme ekranında ve faturada ayrı **indirim kalemi** olarak görünür. Düşürmede fark sonraki döneme alacak olur. Aylık↔yıllık geçiş aynı kurala tabi |
| 6 | Fatura satıcısı | Technowide; unvan, VKN, vergi dairesi, adres, IBAN, seri/no admin ayarlarından |
| 7 | Fatura alıcısı | İşletme kendi ayarlarından girer; girmemişse **11111111111** TCKN ile nihai tüketici e-Arşiv faturası |
| 8 | KDV | Plan fiyatları KDV **dahil** gösterilir; faturada %20 KDV ayrıştırılır |
| 12 | Yıllık fiyat | Admin plan bazında **ya sabit yıllık fiyat** girer **ya da indirim kuralı** seçer: "yıllık alımda X TL indirim" veya "%Y indirim" (aylık × 12 üzerinden). Yıllık fiyat bu kurala göre hesaplanır |
| 13 | Deneme planı | Günlük 10 işlem, 2 personel, WhatsApp ve AI kapalı, sözleşme açık (admin sonradan değiştirebilir) |
| 14 | Süreler | Hatırlatma günleri 7 / 3 / 1; havale bekleme süresi **3 gün** (cuma → pazartesi) |
| 9 | Özellik kataloğu | Kodda tanımlı ve uygulanan özellikler + admin'in eklediği yalnızca gösterim amaçlı özellikler |
| 10 | Ödeme kanalı | Şimdilik yalnızca havale/EFT; online sağlayıcılar için kanal arayüzü baştan kurulur |
| 11 | Entegratör | Kapsam dışı; XML ve PDF arşiv kaydı olarak üretilir, GİB'e gönderim yok |

Varsayılanla kapatılan konular: indirim kodu kuralları (§6), enterprise fiyat modeli (§9).

---

## 1. Kapsam ve fazlar

Tek bir uygulama planı için fazla büyük; beş faza bölünür. Her faz kendi başına canlıya çıkabilir.

| Faz | İçerik | Bağımlılık |
|-----|--------|------------|
| **F1 — Plan ve yetkilendirme çekirdeği** | Plan/özellik tabloları, abonelik kaydı, deneme planına geçiş, `entitlements` paketi ve kod kancaları, işletme "Abonelik" sayfası ve sayaçlar, admin plan yönetimi | — |
| **F2 — Satın alma** | Sipariş, ödeme kanalı arayüzü + havale kanalı, dekont, indirim kodları, kıst hesap, admin ödeme onayı, plan değişikliği | F1 |
| **F3 — Faturalama** | Satıcı ayarları, işletme fatura bilgileri, fatura numaralandırma, `go-ubltr` ile XML, XSLT yönetimi, HTML/PDF, arşiv | F2 |
| **F4 — Yaşam döngüsü ve takip** | Süre bitimi/ek süre/salt okunur, hatırlatmalar (işletme + admin), admin abonelik ve indirim analizleri | F1, F2 |
| **F5 — Enterprise özel limitler** | İşletmenin kendi limitlerini seçmesi, birim fiyatlandırma, admin'e özel fiyat | F1, F2 |

Kapsam dışı: online ödeme sağlayıcısı entegrasyonu (kanal arayüzü hazır olur, sağlayıcı yazılmaz), entegratör/GİB gönderimi, e-Fatura mükellefi ayrımı, çoklu para birimi (TRY sabit), otomatik yenileme (havale ile mümkün değil; yenileme = yeni sipariş).

---

## 2. Mimari genel bakış

```
İşletme paneli                    Admin paneli
  Abonelik sayfası, sayaçlar        Planlar · Abonelikler · Ödemeler · İndirimler · Faturalar · Ayarlar
        │                                   │
        ▼                                   ▼
  /v1/tenant/billing/*              /v1/platform/billing/*
        │                                   │
        └──────────► modules/billing ◄──────┘
                       ├── plans (plan + özellik değerleri)
                       ├── subscriptions (abonelik + dönem)
                       ├── orders (sipariş, kıst, indirim, ödeme bildirimi)
                       ├── payments (kanal arayüzü; bank_transfer)
                       ├── discounts (indirim kodları)
                       ├── invoices (numara, kalemler, XML/PDF)
                       └── settings (satıcı, IBAN, ek süre, XSLT)
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                  ▼
   platform/entitlements   platform/ubltr      notifycenter
   (limit kontrolü,        (go-ubltr sarmalı,  (hatırlatma, onay
    kullanım sayaçları)     XSLT, Gotenberg)    bildirimleri)
```

- Backend'de tek modül: `internal/modules/billing` (handler, usecase, routes). Alt alanlar usecase içinde ayrı dosyalar.
- Limit kontrolü, diğer modüllerin bağımlı olacağı ince bir platform paketi: `internal/platform/entitlements`. Billing modülünü import etmez; sadece "bu işletmenin şu anki özellik değerleri ve kullanımı" okur.
- Frontend'de `features/billing` (tenant) ve `features/platform-billing` (admin).
- Kurallar korunur: browser yalnızca `/api/v1/*`, yeni route'lar OpenAPI'ye, izin slug'ları migration + rbac + permissions.ts.

---

## 3. Veri modeli

Tablolar (migration `000064+`):

**`billing_features`** — özellik kataloğu. Kodda tanımlı olanlar açılışta upsert edilir (`is_builtin = true`), admin gösterim amaçlı olanları ekler.
- `key` (unique: `jobs.daily`, `staff.count`, `module.contracts` …), `kind` (`limit` | `toggle` | `display`), `unit` (`adet`, `GB` …), `period` (`day` | `month` | `total` | `none`), `label_tr/en`, `sort_order`, `is_builtin`, `is_active`.

**`billing_plans`**
- `code` (unique), `name`, `description`, `price_monthly` (KDV dahil, numeric 18,2), `yearly_pricing` (`fixed` | `discount_amount` | `discount_percent`), `price_yearly` (fixed ise), `yearly_discount_value` (kural ise; TL veya yüzde), `currency` (`TRY`), `is_public` (fiyat sayfasında görünür), `is_customizable` (enterprise), `sort_order`, `badge` (`popular` vb.), `is_active`, `deleted_at`.
- `trial` kodlu plan da buradadır; deneme süresi plan üzerinde `trial_days` alanı (14). Seed değerleri: günlük 10 işlem, 2 personel, WhatsApp ve AI kapalı, sözleşme açık.

**`billing_plan_features`** — plan × özellik değeri
- `plan_id`, `feature_id`, `value_int` (limit), `value_bool` (toggle), `enforcement` (`hard` | `soft`), `tolerance_pct` (0–100), `warn_pct` (varsayılan 80), `display_text` (gösterim özellikleri için serbest metin).
- Enterprise için ek: `min_value`, `max_value`, `step`, `unit_price` (adım başına KDV dahil aylık fiyat; §9).

**`billing_subscriptions`** — bir işletmenin bir dönemdeki aboneliği (işletme başına en fazla bir `active`).
- `organization_id`, `plan_id`, `period` (`monthly` | `yearly`), `status` (`trial` | `active` | `grace` | `read_only` | `cancelled`), `starts_at`, `ends_at`, `grace_ends_at`, `price_paid`, `credit_balance` (düşürmeden kalan alacak), `custom_features` (jsonb; enterprise'da seçilen değerler), `source` (`self_service` | `admin`), `note`, `created_by`.
- `organizations.plan_code / access_starts_at / access_ends_at` alanları korunur ama **türetilmiş** hale gelir: abonelik değiştikçe billing bunları günceller (mevcut middleware bozulmaz).

**`billing_orders`** — satın alma niyeti + ödeme bildirimi
- `organization_id`, `plan_id`, `period`, `kind` (`new` | `renew` | `upgrade` | `downgrade` | `period_change`), `status` (`pending_payment` | `payment_reported` | `approved` | `rejected` | `cancelled` | `expired`), `channel` (`bank_transfer`), `reference_code` (havale açıklaması, örn. `OTO-7F3K2Q`), `list_price`, `proration_credit`, `discount_code_id`, `discount_amount`, `credit_applied`, `total` (ödenecek), `vat_amount`, `lines` (jsonb; fatura kalemlerinin ön hali), `receipt_object_key` (dekont), `reported_at`, `reviewed_by`, `reviewed_at`, `reject_reason`, `expires_at` (ödeme bekleme süresi, varsayılan 3 gün), `custom_features` (jsonb).

**`billing_discount_codes`** — `code` (unique, büyük harf), `kind` (`percent` | `amount`), `value`, `applies_to_plans` (bigint[]; boş = hepsi), `applies_to_periods` (`monthly`/`yearly`/boş), `starts_at`, `ends_at`, `max_uses`, `max_uses_per_org`, `first_purchase_only`, `is_active`, `note`.
**`billing_discount_uses`** — `discount_code_id`, `organization_id`, `order_id`, `amount`, `used_at`.

**`billing_invoices`**
- `organization_id`, `order_id`, `number` (seri + yıl + sıra, örn. `TWD2026000000012`), `uuid` (UBL için), `issue_date`, `profile` (`EARSIVFATURA`), `type` (`SATIS`), `buyer` (jsonb snapshot), `seller` (jsonb snapshot), `lines` (jsonb), `subtotal`, `discount_total`, `vat_total`, `grand_total`, `xml_object_key`, `pdf_object_key`, `xslt_version` (hangi XSLT ile üretildi), `status` (`issued` | `voided`).
**`billing_invoice_counters`** — `series`, `year`, `last_no` (satır kilidiyle atomik numara).

**`billing_settings`** — tek satır (org'suz, platform): satıcı bilgileri (unvan, VKN, vergi dairesi, adres, e-posta, telefon, web), `iban`, `bank_name`, `account_holder`, `payment_instructions` (metin), `grace_days` (3), `order_ttl_days` (3), `invoice_series` (`TWD`), `vat_rate` (20), `xslt_object_key` (admin XSLT; boşsa repodaki `general.xslt`), `reminder_days` (`[7,3,1]`).

**`organizations`** ek sütunlar: `invoice_name`, `invoice_tax_id`, `invoice_tax_office`, `invoice_address`, `invoice_email` (işletmenin fatura bilgileri).

**`billing_usage_counters`** — dönemsel sayaçlar (`organization_id`, `feature_key`, `period_key` = `2026-09-27` / `2026-09` / `total`, `value`). Hız için; kaynak tablolardan yeniden hesaplanabilir.

---

## 4. Yetkilendirme (entitlements) ve limit uygulaması

`internal/platform/entitlements`:

```go
type Decision struct {
    Allowed   bool   // false → sert engel
    Soft      bool   // yumuşak limit aşıldı (izin var, uyar)
    Limit     int64
    Used      int64
    Tolerance int64  // limit × tolerance_pct
    WarnAt    int64
}
func (s *Service) Check(ctx, orgID int64, key string, delta int64) (Decision, error)
func (s *Service) Consume(ctx, orgID int64, key string, delta int64) error   // sayaç artır
func (s *Service) Enabled(ctx, orgID int64, key string) (bool, error)        // toggle
func (s *Service) Snapshot(ctx, orgID int64) (Snapshot, error)               // UI için tüm özellikler + kullanım
```

Karar kuralı (limit türü):
- `used + delta ≤ limit` → izin.
- `limit < used + delta ≤ limit × (1 + tolerance)` → izin; `Soft=true` (uyarı + admin bildirimi).
- Üstü → `hard` ise engel (`409 LIMIT_REACHED`, gövdede limit/kullanım), `soft` ise izin + uyarı.
- Kullanım `warn_pct`'yi geçince UI sayaç sarı, limitte kırmızı.

Efektif değer sırası: abonelikteki `custom_features` (enterprise) → plan özellik değeri → özellik yoksa sınırsız/açık.

İlk sürümde kodda tanımlı özellikler ve kancaları:

| key | tür | dönem | kanca |
|-----|-----|-------|-------|
| `jobs.daily` | limit | gün | jobs Create, quotes Convert |
| `jobs.monthly` | limit | ay | aynı |
| `staff.count` | limit | toplam | staff davet/ekleme (sayım: aktif üyeler) |
| `customers.count` | limit | toplam | customers Create, import |
| `storage.gb` | limit | toplam | storage upload (sayım: mevcut toplam boyut) |
| `whatsapp.enabled` / `whatsapp.monthly` | toggle + limit | ay | messaging gönderimi |
| `ai.enabled` / `ai.monthly` | toggle + limit | ay | ai istekleri |
| `module.contracts` | toggle | — | contracts route'ları (middleware) |
| `module.quotes` | toggle | — | leads + quotes route'ları |
| `module.reports` | toggle | — | reports + export route'ları |

Toggle kapalı modül: backend `403 FEATURE_DISABLED`; frontend nav'da kilit simgesi, sayfada "Bu özellik planınızda yok" kartı ve yükseltme linki.

Salt okunur mod (F4): `RequireOrganization` middleware'i abonelik durumu `read_only` ise `GET` dışındaki tenant isteklerini `403 SUBSCRIPTION_READ_ONLY` ile keser; `/v1/tenant/billing/*` ve `/v1/tenant/exports/*` hariç.

---

## 5. Satın alma akışı (F2)

**Ödeme kanalı arayüzü** (`usecase/channels.go`):
```go
type Channel interface {
    Kind() string                                        // "bank_transfer", ileride "iyzico"
    Start(ctx, order) (Instructions, error)              // ne yapılacağı: IBAN + referans / yönlendirme URL'i
    Report(ctx, order, ReportInput) error                // işletme "ödedim" dedi (dekont)
    Confirm(ctx, order, ConfirmInput) error              // admin onayı / sağlayıcı callback
}
```
`bank_transfer`: `Start` IBAN, hesap sahibi, tutar ve referans kodunu döner; `Report` dekontu storage'a yazar ve durumu `payment_reported` yapar; `Confirm` admin onayıdır.

**Sipariş oluşturma** (`POST /v1/tenant/billing/orders`): plan + dönem + opsiyonel indirim kodu + (enterprise) özel değerler.
1. Mevcut aboneliğe göre `kind` belirlenir.
2. Liste fiyatı = plan dönem fiyatı (+ enterprise adım fiyatları). Yıllık fiyat: `fixed` → `price_yearly`; `discount_amount` → `price_monthly × 12 − X`; `discount_percent` → `price_monthly × 12 × (1 − Y/100)`. Plan kartında "Yıllık alımda X TL / %Y indirim" rozeti gösterilir.
3. **Kıst hesap**: mevcut abonelik aktifse `kalan_gün / dönem_gün × ödenen_fiyat` = `proration_credit`. Yeni tutar ≥ kredi ise düşülür; küçükse fark `credit_balance`'a yazılır ve sonraki siparişte `credit_applied` olarak düşer.
4. İndirim kodu doğrulanır (§6), `discount_amount` hesaplanır (kıst sonrası tutar üzerinden).
5. `total = max(0, list − proration − discount − credit)`; `vat_amount = total − total / 1.20`.
6. `lines` yazılır: `+ Plan (dönem)`, `− Kıst iadesi (eski plan, X gün)`, `− İndirim kodu KOD`, `− Alacak bakiyesi`. Faturada aynen kullanılır.
7. Referans kodu üretilir, `pending_payment`, `expires_at = now + order_ttl_days` (3 gün; cuma yapılan sipariş pazartesiye kadar açık kalır).

**İşletme tarafı UI** (`/t/{slug}/settings/billing`): plan kartları (aylık/yıllık anahtarı, "Mevcut planınız", fiyat farkı), özet (kalemler), "Havale bilgileri" adımı (IBAN, tutar, referans; kopyala), "Ödemeyi bildir" (dekont yükle + not), durum takibi (Ödeme bekleniyor → İnceleniyor → Onaylandı/Reddedildi). Mobilde çalışır.

**Admin onayı** (`/platform/billing/payments`): bekleyen ödemeler listesi (işletme, plan, tutar, referans, dekont önizleme, gönderim tarihi). Onay → abonelik oluşturulur/güncellenir, `organizations` erişim alanları senkronlanır, fatura üretilir (F3), işletmeye bildirim. Red → sebep zorunlu, işletmeye bildirim, sipariş `rejected`.

**Elle abonelik** (`POST /v1/platform/billing/subscriptions`): admin plan, dönem, başlangıç, bitiş, tutar (0 olabilir), not girer; `source = admin`. "Süre uzat" aynı uçtan `ends_at` değiştirir. Fatura isteğe bağlı (kutucuk).

Sipariş süresi dolarsa (`expires_at`) sistem `expired`'a çeker; işletme yeni sipariş açar.

---

## 6. İndirim kodları

- Admin oluşturur: kod, yüzde/tutar, plan ve dönem kısıtı, geçerlilik aralığı, toplam ve işletme başına kullanım, "yalnızca ilk satın alma", not.
- Doğrulama sırası: aktif → tarih → plan/dönem → toplam kullanım → işletme kullanımı → ilk satın alma. Hata mesajları Türkçe/İngilizce ve nedeni söyler.
- Kullanım kaydı sipariş **onaylandığında** kesinleşir; reddedilen/expire olan siparişler kullanımı geri bırakır.
- Analiz (F4): kod başına kullanım sayısı, toplam indirim tutarı, indirimle gelen ciro, ilk kullanım dağılımı; plan kırılımı.

---

## 7. Faturalama (F3)

- **Ne zaman:** sipariş onaylandığında ve `total > 0` ise (0 TL'lik siparişte fatura kesilmez; admin isterse elle kesebilir).
- **Numara:** `invoice_series + yıl + 9 haneli sıra`, `billing_invoice_counters` üzerinde satır kilidiyle.
- **Kalemler:** siparişteki `lines` → UBL `InvoiceLine`'lar; negatif kalemler UBL'de `AllowanceCharge` (indirim) olarak, açıklamasında "Kıst iadesi — Temel Plan, 20 gün" / "İndirim kodu HOSGELDIN" yazar. Böylece karar #5 faturada görünür.
- **Taraflar:** satıcı `billing_settings`'ten; alıcı `organizations.invoice_*` varsa VKN/TCKN ile, yoksa `TCKN 11111111111`, ad "Nihai Tüketici" + işletme adı notta.
- **Üretim:** `platform/ubltr` sarmalı: `builder.NewInvoiceBuilder()` (profil `EARSIVFATURA`, tür `SATIS`, `TRY`, KDV %20) → `ubltr.Marshal` → `ubltr.ValidateXSD` (+ Schematron; hata varsa fatura `issued` olmaz, admin'e hata gösterilir, sipariş onayı yine tamamlanır) → `render.NewHTML(helium, style)` → HTML → mevcut Gotenberg istemcisiyle PDF. XML ve PDF object storage'a; indirme API-üzerinden (kural: browser key birleştirmez).
- **XSLT:** varsayılan repodaki `examples/render/general/general.xslt` backend'e gömülür (`embed`). Admin `/platform/billing/settings` → "Fatura şablonu (XSLT)" tek dosya yükler; yüklendiğinde **yalnızca o** kullanılır, "Varsayılana dön" ile silinir. Yüklemede örnek fatura ile deneme render'ı yapılır, hata varsa kabul edilmez. Fatura kaydına hangi XSLT ile üretildiği yazılır; "Yeniden üret" ile mevcut XSLT'yle PDF tazelenir (XML değişmez).
- **Görünüm:** admin fatura listesi (ara, tarih, işletme; XML/PDF indir, önizle, iptal → `voided` + not); işletme tarafında Abonelik sayfasında "Faturalarım" (PDF indir).

---

## 8. Yaşam döngüsü, hatırlatmalar, takip (F4)

- Worker'da günlük görev (`@daily 03:00 Europe/Istanbul`) + saatlik kontrol:
  - `ends_at` geçti → `grace`, `grace_ends_at = ends_at + grace_days`; `organizations.access_ends_at = grace_ends_at`.
  - `grace_ends_at` geçti → `read_only`; `organizations.status` `active` kalır (middleware salt okunur kuralı §4 ile). Tam kilit yok.
  - Deneme: kayıt sırasında `trial` planıyla `status=trial` abonelik açılır; bitince aynı yol.
- **Hatırlatmalar** (notifycenter üzerinden, mevcut şablon altyapısı; tür `billing.*`):
  - İşletme sahiplerine: bitişe `reminder_days` (7, 3, 1) kala, bitiş günü, ek süre başlangıcı, salt okunur başlangıcı; sipariş onay/red; ödeme bekleyen sipariş 3 gün sonra hatırlatma.
  - Admin'e: günlük özet — bugün bekleyen ödemeler, 7 gün içinde bitecek abonelikler, ek süredekiler, salt okunura düşenler; yumuşak limit aşımları.
  - Kanallar: uygulama içi + e-posta; WhatsApp mevcut kurallar altyapısıyla isteğe bağlı.
- **Admin abonelik takibi** (`/platform/billing/subscriptions`): tablo (işletme, plan, dönem, durum, başlangıç/bitiş, kalan gün, kaynak), filtreler (durum, plan, "7 gün içinde bitecek"), satır detayı (geçmiş abonelikler, siparişler, faturalar, kullanım anlık görüntüsü), işlemler (süre uzat, plan değiştir, not, salt okunuru kaldır).
- **Gösterge paneli** (`/platform/billing`): aktif abonelik sayısı, plan dağılımı, bu ay onaylanan tutar, bekleyen ödeme, 7/30 gün içinde bitecek, deneme→ücretli dönüşüm oranı, indirim kodu özetleri.

---

## 9. Enterprise özel limitler (F5)

- `is_customizable = true` planlarda (ör. `enterprise`) sayısal özelliklerin `min/max/step/unit_price` alanları doldurulur; `price_monthly` taban fiyattır.
- İşletme plan kartında kaydırıcılarla değer seçer; fiyat anlık hesaplanır: `taban + Σ((seçilen − min) / step × unit_price)`; yıllıkta adım fiyatı × 12'ye planın yıllık indirim kuralı (#12) aynen uygulanır.
- Seçilen değerler siparişe (`custom_features`) ve onayda aboneliğe yazılır; entitlements bunları planın önüne alır.
- Admin "işletmeye özel fiyat" tanımlayabilir: admin elle sipariş oluşturur (tutarı yazar), işletme normal akışta öder. Böylece kod tarafında ayrı bir "özel fiyat" yapısı gerekmez.
- Fatura kaleminde özel değerler açıklama olarak yazılır ("Enterprise · günlük 120 işlem, 15 personel").

---

## 10. API yüzeyi (özet)

Tenant (`tenant.billing.read` = tüm üyeler, `tenant.billing.write` = owner):
- `GET /v1/tenant/billing/overview` — abonelik, plan, kullanım anlık görüntüsü, durum, alacak bakiyesi
- `GET /v1/tenant/billing/plans` — herkese açık planlar ve fiyat farkları
- `POST /v1/tenant/billing/orders/preview` — kalemleri ve tutarı hesaplar (kod doğrulama dahil)
- `POST /v1/tenant/billing/orders`, `GET .../orders`, `GET .../orders/{uuid}`, `POST .../orders/{uuid}/report` (dekont), `POST .../orders/{uuid}/cancel`
- `GET/PUT /v1/tenant/billing/invoice-profile` — fatura bilgileri
- `GET /v1/tenant/billing/invoices`, `GET .../invoices/{uuid}/pdf`

Platform (`platform.billing.read`, `platform.billing.write`, `platform.billing.settings`):
- Planlar ve özellikler CRUD; `GET /v1/platform/billing/features`
- Abonelikler: liste, detay, elle oluştur, uzat, plan değiştir, salt okunuru kaldır
- Siparişler/ödemeler: liste, onay, red
- İndirim kodları CRUD + `GET .../discount-codes/{uuid}/stats`
- Faturalar: liste, XML/PDF, iptal, yeniden üret
- Ayarlar: `GET/PUT /v1/platform/billing/settings`, `POST/DELETE .../settings/xslt`
- `GET /v1/platform/billing/dashboard`

Tümü OpenAPI'ye eklenir; izinler migration + `rbac` + `permissions.ts`.

---

## 11. Frontend

- **Tenant:** `features/billing` — `settings/billing` sayfası (plan seçimi, ödeme adımları, durum, faturalar, fatura bilgileri formu); `UsageMeter` bileşeni (renkli sayaç; %warn sarı, %100 kırmızı, tolerans bölgesi çizgili); genel bant (`SubscriptionBanner`: ek süre / salt okunur / ödeme bekleniyor); limit hatası için ortak `LimitReachedDialog` (mesaj + "Planı yükselt"). Mevcut sayfalarda sayaç yerleşimi: İşlemler üst çubuğunda günlük işlem sayacı, Personel sayfasında personel sayacı, Müşteriler'de müşteri sayacı, Dosyalar'da depolama.
- **Admin:** `features/platform-billing` — nav'da "Abonelik" grubu: Gösterge paneli, Planlar, Abonelikler, Ödemeler (bekleyen rozetli), İndirim kodları, Faturalar, Ayarlar. DataTable/EntityPage kalıpları kullanılır.
- Tüm metinler tr/en; tarih alanlarında `admin-date-picker` skill'i.

---

## 12. Hata yönetimi ve kenar durumlar

- Aynı işletmede iki açık sipariş olamaz (`409`), yeni sipariş öncekini iptal etmeyi teklif eder.
- Onay sırasında plan silinmiş/pasifse onay reddedilir, admin uyarılır.
- Sayaç tutarsızlığı: günlük görev sayaçları kaynak tablolardan yeniden hesaplar (`jobs.daily` = bugünkü iş sayısı vb.).
- Fatura üretimi başarısızsa sipariş onayı geri alınmaz; fatura `failed` notuyla kuyruğa düşer, admin "yeniden üret" der.
- Storage/Gotenberg erişilemezse PDF sonra üretilir; XML kaydı yeterlidir.
- Saat dilimi: dönem ve günlük sayaçlar `Europe/Istanbul` gününe göre.

---

## 13. Test stratejisi

- Birim: kıst hesap, indirim doğrulama, tolerans/karar tablosu, numara üretimi, UBL mapper (kalemler, indirim kalemleri, alıcı fallback), XSLT ile render.
- DB testleri (mevcut `*_db_test.go` düzeni): sipariş → onay → abonelik → fatura akışı; süre bitimi geçişleri; sayaç yeniden hesaplama; eş zamanlı sipariş.
- Kancalar: jobs/customers/staff oluşturma limitleri için mevcut usecase testlerine senaryolar.
- UI: Playwright ile satın alma akışı ve sayaç renkleri (mevcut yerel test kullanıcısıyla).

---

## 14. Kapatılan açık noktalar

KDV dahil gösterim, deneme limitleri, yıllık fiyat kuralı, hatırlatma günleri ve 3 günlük bekleme süresi §0 karar tablosuna (#8, #12–#14) işlendi.
