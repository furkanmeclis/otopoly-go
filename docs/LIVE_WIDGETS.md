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

The widget push carries the numbers themselves: counts, today's collected total and up to 12 open jobs, all under 4 KB. The background task makes **no network call**, which matters because:

- it works on a locked phone, where the keychain-protected session is unavailable;
- it fits in the ~30 s iOS background window.

`buildTodayPropsFromSnapshot` (`src/features/widgets/props.ts`) uses the same labels and formatters as the in-app `buildTodayProps`.

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

All four routes need `tenant.jobs.read`. They are rate limited to 30 requests per minute per user.

| Method | Path | Body → `data` |
| --- | --- | --- |
| PUT | `/v1/tenant/live-activities/device` | `{ device_token, push_to_start_token?, widgets? }` → `{ widgets_enabled, push_to_start, live_activity_push }` |
| DELETE | `/v1/tenant/live-activities/device/{token}` | → `{ status: "ok" }` |
| PUT | `/v1/tenant/live-activities/jobs/{uuid}` | `{ platform, activity_id, push_token? (iOS), device_token? (Android), locale? }` → `{ uuid, job_uuid, platform, activity_id, expires_at, remote_updates }` |
| POST | `/v1/tenant/live-activities/jobs/{uuid}/unregister` | `{ activity_id?, device_token? }` → `{ status: "ok" }` |

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
