# Wave 1 backend contracts (for mobile mocks)

Source branches in `~/Documents/Projects/otopoly-go`: `feat/auth-otp-native-oauth`, `feat/expo-push-limits`.
Neither is merged yet. The authoritative spec is `backend/docs/openapi.yaml` on those branches. Read it with `git -C ~/Documents/Projects/otopoly-go show origin/<branch>:backend/docs/openapi.yaml`.

Every response uses the envelope `{success, data, meta}`. Every endpoint that returns tokens uses the same shape as `/v1/auth/login`: `{access_token, refresh_token, token_type, expires_in, refresh_expires_at}`. Error `details` is a list of `[{field, message}]` objects, and every `message` is a string.

## Auth (`feat/auth-otp-native-oauth`)

### Email code login
**`POST /v1/auth/email-code/request {email}`**
- Always returns `200 {status:"accepted"}`, whether or not the account exists.
- `429 RATE_LIMITED` comes with a `Retry-After` header.

**`POST /v1/auth/email-code/verify {email, code, totp_code?, organization_slug?}`** returns tokens.
- `400 INVALID_EMAIL_CODE`: wrong or expired code.
- `403 MFA_REQUIRED`: send the same `code` again together with `totp_code`.
- `401 INVALID_MFA_CODE`
- `403 ACCOUNT_DEACTIVATED`
- `403 NO_TENANT_MEMBERSHIP`

### Native Apple / Google sign-in
**`POST /v1/auth/oauth/{apple|google}/native {id_token, nonce?, given_name?, family_name?, authorization_code?, totp_code?, organization_slug?}`** returns tokens.
- Apple: send `authorization_code` and, on the first sign-in, the first and last name.
- `409 OAUTH_ACCOUNT_NOT_LINKED`: an account with this email exists but the provider isn't linked to it. Message to show: "Sign in the usual way and link it from your profile."
- `409 OAUTH_LINK_CHOICE_REQUIRED` (Apple private relay only, user not found):
  - `details` contains `link_ticket`, `provider`, `expires_in` (900) and `register_allowed` (`"true"` or `"false"`).
  - The app asks "Hesabım var mı?" (Do you have an account?).
- Other errors: `401 INVALID_ID_TOKEN`, `403 OAUTH_PROVIDER_DISABLED`, `400 VALIDATION_ERROR`.

### Linking a private-relay Apple sign-in
**`POST /v1/auth/oauth/link/request {link_ticket, email}`**
- Returns `200 accepted`. If the email has an account, a code is sent to it.
- `400 INVALID_LINK_TICKET`

**`POST /v1/auth/oauth/link/verify {link_ticket, email, code, totp_code?, organization_slug?}`** returns tokens and links the Apple account.
- Errors: `INVALID_LINK_TICKET`, `INVALID_EMAIL_CODE`, the MFA codes above, `409 CONFLICT`.

**`POST /v1/auth/oauth/link/create {link_ticket, totp_code?, organization_slug?}`** creates a new account and returns tokens.
- `403 FORBIDDEN`: registration is closed.

### Account deletion (deactivation, Bearer token required)
**`POST /v1/auth/account/deactivate/request`** (no body)
- Emails a 6-digit code. Limit: 5 per 15 minutes.

**`POST /v1/auth/account/deactivate {code?}`** returns `{status:"deactivated"}`.
- `403 STEP_UP_REQUIRED`
- `400 INVALID_EMAIL_CODE`
- `409 CONFLICT`
- After this, every login attempt returns `403 ACCOUNT_DEACTIVATED`. The data is kept, only marked passive.

### Store review
The env var `AUTH_REVIEW_ACCOUNTS=email:code` lets a review account use a fixed code. No email is sent for it.

## Push and limits (`feat/expo-push-limits`)

### Push device registration
**`POST /v1/push-devices {token, platform: ios|android, locale?, app_version?, device_name?}`** returns `{device:{uuid, token, platform, locale, app_version, device_name, last_seen_at, created_at}, push_enabled}`.
- Upsert: registering the same token again updates the existing device.
- Devices belong to the user, so no org context is needed.
- Call it after sign-in and whenever the token changes.

**`DELETE /v1/push-devices/{urlencoded token}`** returns `{status:"ok"}`.
- Idempotent.
- Call it on logout, **before** the access token is deleted.

### Notification preferences
Existing endpoints:
- `GET` / `PUT /v1/notification-preferences` (includes `push_enabled`)
- `/v1/tenant/notification-preferences`

### Push payload
`{title, body, data:{url?, notification_uuid, kind?}}`

The title and body are lock-screen safe.

| `kind` | `data.url` |
|---|---|
| `quote.team_*` | `/t/{slug}/quotes/{uuid}` |
| `todo.reminder` | The todo's link, in the same format as on the web |
| `billing.usage_warning`, `billing.limit_full`, `billing.limit_reached`, `billing.subscription_ending` | `/t/{slug}/settings/billing`. The app opens the "Kullanım ve limitler" screen (`settings/usage`). |

### Notification inbox
Existing endpoints:
- `GET /v1/notifications`
- `/v1/notifications/unread-count`
- `/v1/notifications/read-all`
- `/v1/notifications/{uuid}/read`
- `/v1/notifications/{uuid}/action`

### `LIMIT_REACHED` details
`feature`, `limit`, `used`, `tolerance`, `owner_notified` (`"true"` or `"false"`).

### Usage screen
Uses the existing `GET /v1/tenant/billing/overview` (`meters[]`, `subscription`).

### Universal links
- Domain: **`otopoly.app`**. The API lives at `api.otopoly.app`.
- AASA paths: `/t/*`, `/q/*`, `/login/qr/*`, plus `webcredentials`.
- In `app.json`:
  - iOS: `ios.associatedDomains: ["applinks:otopoly.app", "webcredentials:otopoly.app"]`
  - Android: `intentFilters` for `https://otopoly.app` with `autoVerify` on the same paths.

## QR login (`feat/qr-login`, stacked on auth)

The QR login session state lives in Redis.

### Endpoints
- **`POST /v1/auth/qr/sessions`** (public). Called by the web.
  - Returns `{session_id, qr_url, browser_secret, expires_at, realtime:{ws_url, connection_token, subscription_token, channel}}`.
  - The session expires after 120 seconds.
- **`GET /v1/auth/qr/sessions/{id}`** (Bearer). Called by the mobile app.
  - Returns the browser, version, OS and device type, the IP, the location (or `null`), and the session's creation and expiry times.
  - The first account to open the session claims it.
- **`POST /v1/auth/qr/sessions/{id}/approve`** and **`POST /v1/auth/qr/sessions/{id}/reject`** (Bearer).
  - Approve uses the caller's active organization.
- **`POST /v1/auth/qr/sessions/{id}/state {browser_secret}`**. Called once by the web after it re-subscribes, so it doesn't miss a missed event.
- **`POST /v1/auth/qr/exchange {session_id, browser_secret, exchange_token}`**. Called by the NextAuth `qr-login` provider.
  - Returns a token pair and `user`.

### Errors
- `404 QR_SESSION_NOT_FOUND`
- `409 QR_SESSION_CLAIMED`
- `409 QR_SESSION_RESOLVED`
- `400 QR_LOGIN_INVALID`
- `403 ACCOUNT_DEACTIVATED`
- `503 REALTIME_DISABLED`

### Realtime channel
- Channel name: `qrlogin:{random}`. Clients subscribe anonymously with a subscription token.
- Events: `approved {exchange_token}` and `rejected`.
