# Abonelik F5 — Enterprise Özel Limitler · Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `is_customizable` planlarda işletmenin sayısal limitleri kaydırıcılarla seçip anlık fiyatla satın alabilmesi; seçilen değerlerin abonelikte uygulanması; admin'in işletmeye özel fiyatlı sipariş açabilmesi.

**Architecture:** `pricing.CustomPrice` saf fonksiyonu taban fiyat + adım fiyatlarını hesaplar; `quoteFor` özelleştirilebilir planda liste fiyatını buradan alır. Seçimler siparişin `custom_features`'ına, onayda aboneliğin `custom_features`'ına yazılır (entitlements bu alanı F1'den beri planın önüne alıyor). Admin özel fiyatlı sipariş = mevcut sipariş akışına `list_price` override'lı platform ucu.

**Spec:** `docs/superpowers/specs/2026-09-27-abonelik-ve-plan-yonetimi-design.md` §9, §0 #12. Önceki fazlar: F1–F4 planları.

## Durum

- [x] Task 1 fiyat hesabı + doğrulama (pricing) + testler
- [x] Task 2 sipariş/önizleme/onay akışına özel değerler + admin özel fiyatlı sipariş + OpenAPI
- [ ] Task 3 frontend admin plan editörü (min/max/adım/birim fiyat) + özel fiyatlı sipariş dialog'u
- [ ] Task 4 frontend işletme yapılandırıcı (kaydırıcılar, anlık fiyat)
- [x] Task 5 doğrulama, ekran görüntüleri, Notion

## Global Constraints

- F1–F4 kısıtları geçerli (same-origin, OpenAPI + `pnpm api:generate`, tutarlar string, testler gerçek ayarlara dokunmaz, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
- Yeni migration yok (`billing_plan_features.min_value/max_value/step/unit_price`, `billing_orders.custom_features`, `billing_subscriptions.custom_features` mevcut).
- Yapılandırılabilir özellik = planı `is_customizable` olan, `kind=limit`, `min_value`, `max_value`, `step > 0`, `unit_price ≥ 0` dolu satır.
- Aylık fiyat = `price_monthly + Σ ((seçilen − min) / step × unit_price)`. Yıllık = aylık × 12'ye planın yıllık kuralı: `fixed` → `price_yearly + Σ(adım fiyatı) × 12`; `discount_amount` → `aylık×12 − X`; `discount_percent` → `aylık×12×(1−Y/100)`. 2 hane, yarım yukarı.
- Doğrulama: seçim yalnız yapılandırılabilir anahtarlar için; `min ≤ v ≤ max`, `(v − min) % step == 0`; eksik anahtar = `min`. Hata `422 CUSTOM_FEATURES_INVALID` (details `field` = anahtar, `message` = neden).
- Özelleştirilemeyen plana `custom_features` gönderilirse 422.
- Plan kalemi etiketi: `"{Plan} ({Dönem}) · {etiket} {değer} {birim}, …"` (yalnız yapılandırılabilir özellikler) — fatura bu etiketi aynen kullanır.
- Onayda `billing_subscriptions.custom_features = order.custom_features` (değerler JSON string: `{"jobs.daily":"120"}` — entitlements `DBStore` string parse ediyor).
- Admin özel fiyatlı sipariş: `POST /v1/platform/billing/orders` `{organization_uuid, plan_uuid, period, custom_features?, list_price, note}` (`platform.billing.write`) → işletmenin açık siparişi varsa `409 ORDER_OPEN`; kıst/alacak/indirim normal kurallarla `list_price` üzerinden hesaplanır; plan etiketi sonuna ` (özel fiyat)`. İşletme normal akışla öder.

## Review Focus

1. **Adım dışı değer:** min 30, step 10, v=35 → 422. Task 1 testi.
2. **Taban değer = ücretsiz ek:** tüm değerler min → fiyat = `price_monthly`. Task 1 testi.
3. **Yıllık indirim:** aylık 2.000 + ek 600 = 2.600 → %10 yıllık = 28.080,00. Task 1 testi.
4. **Onay sonrası limit:** seçilen `jobs.daily=120` onaydan sonra entitlements'ta 120 görünür (plan değeri 60 olsa bile). Task 2 DB testi.
5. **Admin özel fiyat + indirim kodu:** `list_price` 10.000, YAZ10 %10 → 9.000; plan etiketi "(özel fiyat)". Task 2 DB testi.

## API değişiklikleri

- `OrderPreviewInput` / tenant `POST /orders` gövdesi: `custom_features?: { [key: string]: number }`.
- `BillingOrderPreview` + `BillingOrder`: `custom_features: { [key: string]: number }` (boş obje olabilir).
- `BillingPlanFeatureValue` zaten `min_value/max_value/step/unit_price` içeriyor; plan CRUD bunları saklar ve döner (doğrula).
- Yeni: `POST /v1/platform/billing/orders` (yukarıda) → `201 BillingOrder`.
- `BillingAdminSubscription` + `custom_features: { [key: string]: number }`.

### Task 1 — pricing
`pricing.go`: `type CustomOption{Key, Label, Unit string; Min, Max, Step int64; UnitPrice string}`, `func ValidateCustom(opts []CustomOption, sel map[string]int64) (map[string]int64, error)` (eksikleri min ile doldurur), `func CustomMonthly(base string, opts []CustomOption, sel map[string]int64) (string, error)`, `func CustomYearly(plan YearlyRule, monthlyExtra string, base string) string`. Tablo testleri: Review Focus 1–3 + max aşımı + bilinmeyen anahtar.

### Task 2 — akış + admin ucu + OpenAPI
`quoteFor` özelleştirilebilir planda seçimle liste fiyatı + etiket; `CreateOrder` custom_features yazar; `approveTx` aboneliğe kopyalar; `CreateOrderAdmin`; handler/route/OpenAPI; DB testleri Review Focus 4–5.

### Task 3 — frontend admin
Plan editöründe `is_customizable` açıkken limit satırlarına min / max / adım / birim fiyat alanları; Ödemeler sayfasına "Özel fiyatlı sipariş" butonu + dialog (işletme seçici, plan, dönem, yapılandırılabilir değerler, tutar, not).

### Task 4 — frontend işletme
Özelleştirilebilir plan kartında "Yapılandır"; checkout dialog'unda her yapılandırılabilir özellik için kaydırıcı + sayı, anlık önizleme (debounce), kalemlerde seçim etiketi; abonelik kartında aktif özel değerler.

### Task 5 — doğrulama
Enterprise planı oluştur (taban 2.000, jobs.daily 30–200 adım 10 ₺50, staff 5–50 adım 5 ₺100) → işletme 120 işlem / 15 personel seç → sipariş → onay → sayaçlar 120 / 15 → fatura etiketi. Admin özel fiyatlı sipariş. Ekran görüntüleri, Notion F5, push.
