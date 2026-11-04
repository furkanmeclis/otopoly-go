# Error and performance reporting (Sentry protocol)

The app reports crashes, unexpected API failures and performance traces to a **self-hosted tracker that
speaks the Sentry event protocol**. The tracker is not sentry.io and not GlitchTip. We use
`@sentry/react-native` (installed with `npx expo install`) and its Expo config plugin.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | `.env`, EAS env, Xcode Cloud env | The DSN. If it is not set, Sentry is **not initialised** (dev, mock and CI builds don't need it). |
| `EXPO_PUBLIC_APP_ENV` | already used | Becomes the Sentry `environment` (`development` / `preview` / `production`). |
| `SENTRY_DISABLE_AUTO_UPLOAD=true` | EAS (already in `eas.json`), Xcode Cloud | Skips the source map / dSYM upload steps. |

How uploads are switched off:

- **iOS:** `plugins/with-sentry-no-upload.js` adds `SENTRY_DISABLE_AUTO_UPLOAD=${SENTRY_DISABLE_AUTO_UPLOAD:-true}` to `ios/.xcode.env` on every prebuild. Every iOS build (local, Xcode Cloud, EAS) therefore skips the upload unless the variable is explicitly set to something other than `true`.
- **Android:** `sentry.gradle` reads only the real environment. EAS builds get the variable from `eas.json`. For a local release build (`expo run:android --variant release`), export `SENTRY_DISABLE_AUTO_UPLOAD=true` first.

No auth token, org or project is configured anywhere, and none is needed. The config plugin prints a harmless "Missing config for organization, project" warning during prebuild.

## What is sent

- **Crashes:** native crashes and uncaught JS errors (SDK defaults). Also React render errors, caught by:
  - the expo-router route `ErrorBoundary` (`src/components/feedback/error-boundary.tsx`)
  - a root `Sentry.ErrorBoundary` around the providers (`src/app/_layout.tsx`)
- **Unexpected API failures:** HTTP 5xx, network errors and timeouts, from `src/api/client.ts` via `src/lib/monitoring`.
  - Tags: `api.endpoint` (normalised, e.g. `/v1/jobs/:id/photos`), `api.method`, `api.status`, `api.code`, `api.stream` and `api.request_id`.
  - Each endpoint/status pair is reported at most once a minute.
  - **Not reported:** 4xx answers (validation, 401 refresh flow, 403 / `LIMIT_REACHED`, 404, 429) and cancelled streams.
- **Performance:**
  - Navigation traces named after expo-router routes. Route params are never included.
  - App start, slow / frozen frames and JS stalls.
  - Trace sample rate: production 0.2, preview 0.5, development 1.0.
  - Hermes profiling (no extra native setup) on a share of the sampled traces: production 0.1, preview 0.3.
- **User:** the opaque user uuid after sign-in, cleared on sign-out. Never an e-mail or name.
- **Mock mode / QA tour:** API failures are simulated there, so none of them are reported. Events carry an `api_mode` tag.

## What is scrubbed

The scrubbing lives in `src/lib/monitoring/` and is covered by `scripts/smoke/monitoring.smoke.ts`.

- `sendDefaultPii: false`
- No screenshots or view hierarchy.
- `enableCaptureFailedRequests: false`
- No `sentry-trace` / `baggage` headers on API requests (`tracePropagationTargets: []`).
- `beforeSend` / `beforeSendTransaction`:
  - The user is reduced to `{ id }`.
  - `server_name` and the device name are removed.
  - Request data is reduced to the URL without its query string, and the path ids become `:id`.
  - E-mails, phone numbers, bearer / JWT tokens and URL query strings are removed from messages, exception values, span descriptions and extra data.
  - Keys such as `email`, `phone`, `password`, `token`, `authorization`, `body`, `params`, `query` and `headers` are redacted.
- `beforeBreadcrumb`:
  - Touch and console breadcrumbs are dropped, because labels and arguments can contain customer data.
  - HTTP breadcrumbs keep only method, status and the normalised URL.
- iOS native network breadcrumbs are switched off (`enableNetworkBreadcrumbs: false`). This keeps full URLs off native crash reports.

## Limitation: no source maps, no dSYMs

The tracker accepts events at the DSN's envelope endpoint but has **no sentry-cli API** (`/api/0/...` returns 404). Source maps and debug symbols therefore can't be uploaded:

- JS stack traces show minified Hermes bytecode frames (`index.android.bundle:1:123456`), not source file and line.
- Native frames are not symbolicated.

Use the release (`<bundle id>@<version>+<build>`, set by the native SDK) and the event's breadcrumbs, tags and screen name to narrow a problem down. Then reproduce it locally with a dev build.
