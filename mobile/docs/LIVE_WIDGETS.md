# Live Activities, Live Updates and widgets while the app is closed

Widgets and Live Activities can't hold a Centrifugo connection. Until now they only changed while the app was running (`useWidgetSync` pushed snapshots from React Query data). The backend (otopoly-go `internal/modules/livepush`) now pushes changes to the device. The in-app sync stays as it was and still wins while the app is open.

## What is real time and what is best effort

| Surface | Transport | Delivery | Why |
| --- | --- | --- | --- |
| **iOS job Live Activity** (Lock Screen, Dynamic Island) | ActivityKit push over **APNs directly** (`apns-push-type: liveactivity`, per-activity token) | **Real time**: a status change uses priority 10, an edit to content only uses priority 5 | ActivityKit renders the pushed `content-state` itself. The app is not woken. Expo Push Service has no liveactivity push type, so the backend signs APNs requests with a .p8 key. |
| **Android job Live Update** (ongoing notification, Android 16 Live Update chip) | Expo **data-only** message (FCM high priority) → `expo-notifications` background task → `OtopolyLiveUpdates.post` | **Near real time** | FCM high priority wakes the app even in Doze. Android may still deprioritise an app that posts no visible notification, but a re-post of an ongoing notification counts as visible. |
| **iOS widgets** (Home + Lock Screen) | Expo background push (`contentAvailable`, APNs priority 5) → background task → `updateSnapshot` | **Best effort** | iOS budgets background pushes (Apple suggests only a few per hour) and drops them in Low Power Mode or after the user force-quits the app. WidgetKit's own push (iOS 26 `WidgetPushHandler`) only reloads the timeline from shared storage. It can't fetch data, and expo-widgets doesn't expose it, so it would add nothing here. |
| **Android widgets** (Glance) | The same data-only message, high priority | **Near real time** | The headless JS task writes the snapshot, and expo-widgets re-renders the Glance widgets. |

The backend sends at most **one widget push per organization per minute**: a leading push 5 s after the first change, then one trailing push for everything else inside the window. It sends job activity pushes once per job per 2 s window, and skips a recipient who already saw exactly that state. A retry or a no-op edit therefore costs nothing.

The widget push carries the numbers themselves: counts, up to 12 open jobs and — per recipient, by permission — the day's money, alerts and agenda (see [Widgets](#widgets)). The data is trimmed on the server to 3 KB (whole message under 4 KB). The background task makes **no network call**, which matters because:

- it works on a locked phone, where the keychain-protected session is unavailable;
- it fits in the ~30 s iOS background window.

`buildTodayPropsFromSnapshot` (`src/features/widgets/props.ts`) uses the same labels and formatters as the in-app `buildTodayProps`.

## Widgets

Every widget renders the same `TodayWidgetProps` (`src/widgets/types.ts`, `v: 2`): one snapshot, many views. Each one has tr/en labels (phone language, then Turkish), light/dark palettes, a signed-out card, a "no jobs access" card, a locked / loading state for the parts the member can't see, an "HH:mm itibarıyla / as of HH:mm" freshness line (Türkiye clock) and deep links to existing `otopoly://` routes.

| Widget | Platform · families | Shows | Tap |
| --- | --- | --- | --- |
| **Bugün** `OtopolyToday` / `OtopolyTodayAndroid` | iOS small · medium · large; Android 2×2 | In progress (stale warning), ready, delivered; the day's collections and jobs revenue for finance readers; large: the queue with live timers | Operations; large rows → job |
| **Sıradaki araçlar** `OtopolyQueue` / **İş Kuyruğu** `OtopolyQueueAndroid` | iOS medium · large; Android 4×3 (scrolls) | Ready cars first ("Hazır"), then cars at work with elapsed time; "+N araç daha" | Row → `otopoly://jobs/{id}`, header → `operations?filter=ready`, "+" → `jobs/new` |
| **Kasa durumu** `OtopolyCash` / `OtopolyCashAndroid` | iOS small · medium; Android 3×3 | Collections, money out, net; medium: up to 4 cash / bank balances, cash / card split | `otopoly://finance` (balances → `finance/accounts`) |
| **Haftalık ciro** `OtopolyWeek` / `OtopolyWeekAndroid` | iOS small · medium; Android 4×2 | 7 bars of the day's collections (today highlighted), 7-day total | `otopoly://finance` |
| **Uyarılar** `OtopolyAlerts` / `OtopolyAlertsAndroid` | iOS small · medium; Android 3×2 | Unpaid deliveries of the day, products at / below minimum stock, subscriptions past due or due within 7 days, reviews waiting for a follow-up — zero counts hidden, "Her şey yolunda" when empty | `operations?filter=delivered&unpaid=1`, `catalog/products?stock=low_stock`, `loyalty?tab=subscriptions`, `reviews?filter=follow_up` (small: the most urgent one) |
| **Bugünkü takvim** `OtopolyAgenda` / `OtopolyAgendaAndroid` | iOS small · medium; Android 3×2 | Next 2–3 events / to-dos of the day (timed first, then all-day) | `otopoly://calendar`, to-dos → `otopoly://todos` |
| **Açık işler** `OtopolyGlance` | iOS Lock Screen circular · rectangular · inline | Open jobs; in progress · ready; collections (finance readers) | Operations |
| **Tahsilat** `OtopolyCollectedGlance` | iOS Lock Screen circular · rectangular · inline | The day's collections (compact), cash · card; a lock for others | `otopoly://finance` |
| **Yeni iş** `OtopolyNewJob` | iOS Lock Screen circular · rectangular | Shortcut, no data | `otopoly://jobs/new` |

Gallery names and descriptions are Turkish in `app.json` and translated through `assets/locales/{tr,en}.json` → `ios` → `"Localizable.strings"` (keyed by the Turkish text). Expo writes them to `Supporting/<lang>.lproj`, expo-widgets adds those files to the widget extension, and `plugins/with-widget-locales.js` writes the same English map to Android `res/values-en/expo_widgets.xml`. `scripts/smoke/widgets.smoke.ts` fails when a widget has no translation, layout or bridge registration.

### "Tahsilat" (the day's collections)

One definition everywhere — panel dashboard, mobile dashboard, Siri "today", widgets and the WhatsApp daily summary ("Günün tahsilatı"): **every posted income row of the Europe/Istanbul day in the finance ledger**, i.e. job payments taken in cash or by card, product sales, cari collections, package and subscription sales and manual income entries. Transfers between accounts (virman) are type `transfer` and voided rows status `void`, so neither counts. A job closed on **cari** posts no income (it is a receivable); the later cari collection does, so nothing is counted twice. It equals `total_income` of `GET /v1/tenant/finance/summary` for that day (TRY).

"İşlerden ciro" (jobs revenue: paid jobs, cari closes included — `GET /v1/tenant/jobs/summary` `paid_total`) is a different figure and is shown apart (`stats.jobsRevenue`, the medium Bugün widget). Before this change the widgets showed that figure as "Tahsilat".

### Snapshot (`widgets.refresh` data, `GET /v1/tenant/live-activities/widget-snapshot`)

```jsonc
{
  "v": 1, "date": "2026-10-26", "at": 1793016000000,
  "counts": { "in_progress": 2, "ready": 1, "delivered": 5 },
  "paid_total": "4320.50",               // legacy copy of money.collected, only with finance read
  "queue": [{ "id", "plate", "name", "vehicle", "status": "ready" | "in_progress", "started_at" }], "more": 0,
  "money": {                              // tenant.finance.read only
    "cur": "TRY", "collected": "4320.50", "jobs": "3900.00",
    "cash": "1200.00", "card": "2620.50", "transfer": "400.00", "other": "100.00",
    "expense": "750.00", "net": "3570.50",
    "week": ["1000.00", "0.00", "2500.00", "5000.00", "1500.00", "0.00", "4320.50"], // oldest → today
    "accounts": [{ "n": "Nakit Kasa", "t": "cash", "b": "15200.00" }]                   // ≤ 4
  },
  "alerts": { "unpaid": 1, "stock": 3, "renewals": 2, "reviews": 0 },   // each key only with its module's read permission
  "agenda": { "items": [{ "k": "todo" | "event", "id", "t": "Tedarikçiyi ara", "at": "2026-10-26T13:30:00Z" | "" }] } // ≤ 3
}
```

Permissions per recipient (`usecase/widgets.go`): `tenant.jobs.read` is required (members who lost it get no push), `money` needs `tenant.finance.read`, `alerts.stock` `tenant.catalog.read`, `alerts.reviews` `tenant.reviews.read`, `alerts.renewals` `tenant.loyalty.read`, `alerts.unpaid` jobs read, `agenda` `tenant.calendar.read` (events) and / or `tenant.todos.read` (to-dos). A missing part is shown as locked. Permissions come from the user's roles (`user_roles` → `role_permissions`), the same source as the API.

**Cost.** Each part is loaded once per push (about ten small indexed queries per organization per minute at most); recipients with the same access share one snapshot. The debounce / throttle rules are unchanged.

**Size.** The data (`kind`, `org`, `snapshot`) must stay under 3000 bytes; the server drops queue items from the end (counted in `more`) until it fits. A typical day (12 cars, every part) is ~2.9 KB; a busy day with long Turkish names keeps 5–6 cars (`TestWidgetSnapshotFitsPushBudget_DB`, `widgets.smoke.ts`).

**In-app sync.** While the app runs, counts and the queue come from the live jobs list (same as the dashboard); money / alerts / agenda from `GET …/widget-snapshot` (refetched with the jobs list, at most once a minute, 20 requests / min limit). Unchanged snapshots are not re-sent to WidgetKit / Glance, except every 15 min so "as of" stays honest.

## Flows

1. **Job tracking starts** (`LiveActivityCard` → `startJobActivity`): the activity starts locally as before. Then `activityPush.track()` (`live-push.ts`) registers it with `PUT /v1/tenant/live-activities/jobs/{uuid}`:
   - **iOS:** the ActivityKit push token arrives asynchronously through `addPushTokenListener`. The same listener re-registers whenever the token rotates.
   - **Android:** registers the device's Expo push token. The activity id is the job uuid.
2. **App relaunch:** `useWidgetSync` re-tracks every running activity. This re-attaches the token listeners and refreshes the 12 h server lifetime (deduped, at most every 6 h).
3. **Job changes anywhere** (mobile, web panel, AI assistant, quotes, bulk): the jobs module's live-list event (`tenant.jobs`) goes through the `livepush.Publisher` tee. It enqueues one coalesced job task and one widget task.
4. **Job task:** loads the job and the registered activities. It only reaches members who are still active in an organization that isn't suspended, and only on their own devices. For each recipient it builds `JobActivityProps` in that person's language (`users.locale`, then the device locale, then Turkish):
   - **iOS:** `content-state: { name: "JobActivity", props: "<JSON>" }`. A delivered or cancelled job sends `event: end` (dismissed after 15 min, like Android). A voided job ends immediately. "Ready" and "delivered" also light up the screen with a short alert.
   - **Android:** `{ kind: "live.job", org, job, end, props, sent_at }`.
   - **Cleanup:** an ended activity's row is deleted. So are tokens that APNs reports as invalid (410, BadDeviceToken) and devices that Expo reports as DeviceNotRegistered.
5. **Widget link** (`useWidgetSync` → `widgetDevice.sync()`): `PUT /v1/tenant/live-activities/device` with the Expo token. On iOS 17.2+ it also sends the push-to-start token. The organization's uuid and name are stored locally (`widgets.org`), and pushes for any other organization are ignored.
6. **Tracking stops / sign-out:**
   - Ending tracking calls `POST …/jobs/{uuid}/unregister`.
   - Logout unregisters every tracked activity while the session is still valid, then unregisters the push device. That cascades to the widget link.
   - An organization switch only ends the activities locally. The old rows expire on the server, and APNs answers 410 for activities that have ended.
7. **Background task** (`background-push.ts`, defined in `index.ts`):
   - `widgets.refresh`: ignored while the app is in the foreground, because the in-app sync owns the widgets then.
   - `live.job`: Android only. It only touches jobs that still have an ongoing Live Update on this device, so a tracking the user stopped never comes back. An older `sent_at` never overwrites a newer one.

These silent messages are never shown as banners (`isSilentPush` in the foreground handler).

The push-to-start token is **stored but not used for automatic starts**. Starting Live Activities on every member's Lock Screen for every new job would be noise. The stored token enables an opt-in "follow this job from the web panel" later: it would use `event: start`, `attributes-type: LiveActivityAttributes` and `input-push-token: 1`.

## API (otopoly-go, organization from the token)

All live-activity routes need `tenant.jobs.read`. The registration routes are rate limited to 30 requests per minute per user, the snapshot to 20.

| Method | Path | Body → `data` |
| --- | --- | --- |
| PUT | `/v1/tenant/live-activities/device` | `{ device_token, push_to_start_token?, widgets? }` → `{ widgets_enabled, push_to_start, live_activity_push }` |
| DELETE | `/v1/tenant/live-activities/device/{token}` | → `{ status: "ok" }` |
| PUT | `/v1/tenant/live-activities/jobs/{uuid}` | `{ platform, activity_id, push_token? (iOS), device_token? (Android), locale? }` → `{ uuid, job_uuid, platform, activity_id, expires_at, remote_updates }` |
| POST | `/v1/tenant/live-activities/jobs/{uuid}/unregister` | `{ activity_id?, device_token? }` → `{ status: "ok" }` |
| GET | `/v1/tenant/live-activities/widget-snapshot` | → the caller's snapshot (above) |
| GET | `/v1/tenant/finance/today?date=&days=7&currency=TRY` (`tenant.finance.read`) | → `{ date, currency, collected_total, collected_count, by_method{cash,card,transfer,other}, by_source{jobs,sales,cari,loyalty,manual,other}, expense_total, net, series[{date, collected_total, expense_total}], accounts[{uuid,name,type,currency,balance,is_default}] }` |

`remote_updates` / `live_activity_push` is `false` while the backend has no APNs key. iOS activities then keep updating only in the foreground, exactly as before.

## Configuration

**App** (`app.json`):

| Setting | Effect |
| --- | --- |
| `expo-widgets.enablePushNotifications: true` | Adds the `aps-environment` entitlement and sets `ExpoWidgets_EnablePushNotifications`, so activities start with `pushType: .token`. |
| `expo-notifications.enableBackgroundRemoteNotifications: true` | Adds `UIBackgroundModes: remote-notification`. |
| `expo-task-manager` | Autolinked config plugin. It also adds the `fetch` background mode, which we don't use. |
| `expo.autolinking.ios.buildFromSource` | Now also lists `expo-task-manager` and `unimodules-app-loader`, alongside `expo-image`, so no prebuilt binary can drift from the JSI ABI (see the 1.1.0 (16) crash). |

All of this is native configuration: it needs a **new build**, and an OTA update alone isn't enough.

**Backend** (`.env` / Dokploy, API + worker):

| Key | Value |
| --- | --- |
| `APNS_KEY_ID` | 10-character key id |
| `APNS_TEAM_ID` | Apple team id (falls back to `AUTH_APPLE_TEAM_ID`) |
| `APNS_PRIVATE_KEY` | The .p8 PEM. `\n` escapes are allowed on one line. |
| `APNS_BUNDLE_ID` | `com.otopoly.app` (default) |
| `APNS_ENVIRONMENT` | `production` for TestFlight / App Store, `sandbox` for development builds. Activity tokens only work in their own environment. |

Without the key, everything else still works (Android, widgets) and the backend logs `livepush_apns_disabled` once.

**Apple Developer console:**

1. Keys → **+** → enable **Apple Push Notifications service (APNs)** → download the .p8. It can be downloaded only once. The existing Sign in with Apple key can be reused if APNs is enabled on it.
2. Check that the App ID `com.otopoly.app` has **Push Notifications** enabled. EAS / Xcode automatic signing usually does this. Regenerate the provisioning profiles if the capability was off.
3. Broadcast push is not needed.

**Expo:** nothing new. The project's FCM V1 credentials (Android) and APNs key (iOS) in EAS must already exist for regular push. Widget and Android Live Update messages use the same Expo Push Service.

## Verifying on a real device

The simulator can't receive APNs background pushes reliably, and Live Activity pushes need a device or a T2 / Apple-silicon Mac.

- [ ] **iOS:** start tracking a job, lock the phone, then mark the job ready from the web panel. The Lock Screen activity flips to "Teslime hazır" within seconds and the screen lights up. Deliver the job: the activity ends and disappears after about 15 min.
- [ ] **iOS:** force-quit the app, then change the job's services on the web. The activity content updates (priority 5, may take a little longer).
- [ ] **iOS:** keep the app in the background (not force-quit), then create a job on the web. Within about a minute the Home and Lock Screen widgets show the new count. This is best effort, so retry with the phone charging if nothing arrives.
- [ ] **Android 16:** start tracking, swipe the app away, then mark the job ready on the web. The Live Update chip changes to "Teslime hazır". Delivered → the final state stays for 15 min.
- [ ] **Android:** the queue widget updates after a job change on the web, with the app closed.
- [ ] Stop tracking in the app, then change the job on the web: no notification comes back (Android), and the backend row is gone.
- [ ] Sign out: the widgets show the signed-out card, and no further pushes arrive (check the `livepush_*` logs on the worker).
- [ ] Tahsilat: close a job by card, sell a product, take a cari collection and enter a manual income on the web; the Bugün / Kasa / Tahsilat widgets and the dashboard tile show the same total as Finans → Özet for today. A transfer and a voided entry change nothing; a job closed on cari only counts once its cari collection is taken.
- [ ] Permissions: sign in with a member whose role lacks `tenant.finance.read` — Kasa / Haftalık / Tahsilat show the lock, Bugün shows no money, and the push (worker log / proxy) carries no `money`.
- [ ] Add every new widget from the gallery in Turkish and in English (names and descriptions translated), light and dark mode; tap each row / alert / agenda item and check the screen it opens (reviews and products open on the filtered list, operations on unpaid deliveries).
- [ ] Lock Screen: Açık işler, Tahsilat and Yeni iş on circular / rectangular / inline; Yeni iş opens the new job form.
- [ ] Android: Kasa durumu, Uyarılar, Haftalık ciro and Bugünkü takvim resize and render (Glance has no flexible spacing), rows open their links.
