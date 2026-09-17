# Messaging & Contracts UX — Design Spec
*2026-09-17*

---

## Scope

İki bağımsız alt sistem:

1. **Contracts UI/UX** — mevcut contracts flow'unu jobs ile aynı UX dili/hızında çalıştırmak
2. **Messaging modülü** — tenant'a özel WhatsApp/SMS müşteri bildirimleri

---

## 1. Contracts UI/UX

### Hedef
Jobs feature ile aynı UX pattern: data-table, status chip'ler, filtreler, quick-create dialog.

### Değişiklikler

**Contracts list (`/t/{slug}/contracts/instances`):**
- Jobs list ile aynı tablo yapısı: status, müşteri/araç, konu, tarih, sütunlar
- Status chip'ler: `draft`=gri, `pending`=sarı, `executed`=yeşil, `voided`=kırmızı
- Filtre: durum, tarih aralığı, arama (jobs gibi)
- Quick-create butonu: dropdown ile template seç → otomatik subject binding

**Job detail (`job-contracts-section.tsx`):**
- "Sözleşme Ekle" butonu daha belirgin
- İmzalanan sözleşmeler daha öz şekilde gösterilsin

**Contracts template list:**
- Aynı tablo pattern, status toggle (aktif/pasif) açık görünür

### Bağımlılık
Yeni API endpoint gerekmez, mevcut endpoints yeterli.

---

## 2. Messaging Modülü

### Mimari

```
browser → /api/v1/ (BFF) → Go /v1/tenant/messaging/* → messaging.Service → whatsmeow client / sms noop
```

### DB Tabloları (migration 000042)

**`whatsapp_sessions`**
```sql
id, uuid, organization_id FK, jid VARCHAR, status ENUM(disconnected|qr_pending|connected|error),
encrypted_keys BYTEA, phone_number VARCHAR, display_name VARCHAR,
last_seen_at TIMESTAMPTZ, error_message TEXT, created_at, updated_at
```

**`message_templates`**
```sql
id, uuid, organization_id FK, event_type VARCHAR(64), channel VARCHAR(32) [whatsapp|sms],
locale VARCHAR(8) DEFAULT 'tr', subject VARCHAR(200), body TEXT,
variables JSONB DEFAULT '[]', is_active BOOL DEFAULT true, created_at, updated_at
-- UNIQUE(organization_id, event_type, channel, locale)
```

**`notification_rules`**
```sql
id, uuid, organization_id FK, event_type VARCHAR(64), channel VARCHAR(32),
enabled BOOL DEFAULT false, created_at, updated_at
-- UNIQUE(organization_id, event_type, channel)
```

**`outbound_messages`**
```sql
id, uuid, organization_id FK, event_type VARCHAR(64), channel VARCHAR(32),
recipient_phone VARCHAR(20), status VARCHAR(32) [queued|sent|failed],
provider_reference VARCHAR, error_message TEXT, payload JSONB,
subject_type VARCHAR(64), subject_uuid UUID,
sent_at TIMESTAMPTZ, created_at, updated_at
```

### Event Types (sabit liste)

| event_type | Türkçe |
|------------|--------|
| `contract.signed` | Sözleşme imzalandı |
| `job.completed` | İş tamamlandı |
| `job.paid` | Ödeme alındı |
| `sale.created` | Satış oluşturuldu |

### Go Modülü `internal/modules/messaging/`

```
messaging/
├── model/model.go          — Session, Template, Rule, OutboundMessage types
├── providers/
│   ├── whatsapp.go         — WhatsAppProvider (whatsmeow)
│   └── sms.go             — SMSProvider (noop, future hook)
├── usecase/service.go      — Session CRUD, template CRUD, rule CRUD, Send()
├── handler/handler.go      — HTTP handlers
└── routes.go               — RegisterRoutes()
```

### API Routes

```
# Session management (owner only)
GET    /v1/tenant/messaging/session          — session status
POST   /v1/tenant/messaging/session/connect  — get QR code
DELETE /v1/tenant/messaging/session          — disconnect

# Notification rules
GET    /v1/tenant/messaging/rules            — list all event types + enabled state
PATCH  /v1/tenant/messaging/rules/{event_type}/{channel} — toggle enabled

# Templates
GET    /v1/tenant/messaging/templates        — list
POST   /v1/tenant/messaging/templates        — create/upsert by event_type+channel+locale
GET    /v1/tenant/messaging/templates/{uuid} — get
PATCH  /v1/tenant/messaging/templates/{uuid} — update body/subject
DELETE /v1/tenant/messaging/templates/{uuid} — delete
```

### Permissions (migration 000042)

```
tenant.messaging.read   — organization_user (owners + staff)
tenant.messaging.write  — organization_owner only
```

### WhatsApp Session Flow

1. Tenant admin → "WhatsApp Bağla" → `POST /session/connect` → API starts whatsmeow client
2. whatsmeow generates QR → SSE veya polling ile frontend'e ilet
3. Admin telefonda scan → `connected` state → `jid` ve `display_name` kaydedilir
4. `disconnect` → client logout, keys temizle

### Event Dispatch (contracts.signed örneği)

```go
// contracts/usecase/service.go → Sign() sonrası
events.Publish(ctx, events.Event{
    Type: "contract.signed",
    OrgID: orgID,
    Payload: map[string]any{
        "instance_uuid": instance.UUID,
        "subject_type":  instance.SubjectType,
        "subject_uuid":  instance.SubjectUUID,
        "customer_uuid": customerUUID, // jobs'tan resolve edilir
    },
})
```

```go
// messaging modülü event handler
messaging.RegisterEventHandlers(eventBus, messagingSvc)
// → contract.signed → resolve customer phone → send WhatsApp
// → job.completed   → resolve customer phone → send WhatsApp
// → job.paid        → resolve customer phone → send WhatsApp
// → sale.created    → resolve customer phone (if set) → send WhatsApp
```

### SMS Altyapısı (hazır, aktif değil)

- `SMSProvider` interface: `Send(ctx, phone, body) error`
- `NoopSMSProvider` → log only
- `tenant_sms_configs` tablosu wave 2'de: provider (twilio/netgsm), encrypted credentials

### Template Render

`{{customer_name}}`, `{{job_id}}`, `{{amount}}`, `{{business_name}}`, `{{contract_title}}` — `templates.Render()` ile aynı pattern.

---

## 3. Frontend: Messaging Settings

**`/t/{slug}/settings/messaging`**

### WhatsApp Session Bölümü
- Bağlı değil: "Bağla" butonu → QR modal
- Bağlı: telefon numarası + bağlantı tarihi + "Bağlantıyı Kes"
- QR polling: 30s timeout, yenile butonu

### Notification Rules Bölümü
Her event type için tablo satırı:
- İkon + Türkçe açıklama + toggle (enabled/disabled)
- Altında: "Mesaj içeriğini düzenle" link

### Template Editor Bölümü
- Seçili event type için body textarea
- Değişken yardımcısı: `{{customer_name}}` gibi chip'ler
- Önizleme

---

## Uygulama Sırası

| Wave | Görev | Bağımlılık |
|------|-------|------------|
| 1A | Backend: messaging modülü (migration + Go + routes) | — |
| 1B | Frontend: contracts UI/UX iyileştirmesi | — |
| 2A | Backend: event hooks (contracts + jobs + sales → messaging) | 1A |
| 2B | Frontend: messaging settings UI | 1A |
