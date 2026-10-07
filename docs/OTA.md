# OTA updates

Otopoly uses EAS Update through `expo-updates` so JavaScript and asset-only changes can ship without a new App Store or Play Store build. Native changes still require a new build.

## Configuration

- Update URL: `https://u.expo.dev/a5e4bc16-f23b-4735-bd29-81f3355f02a8`
- Launch behavior: check on launch and do not block startup (`fallbackToCacheTimeout: 0`). A downloaded update is applied on the next app restart.
- Runtime version policy: `appVersion`.
- Channels:
  - EAS Android builds use `eas.json` profile channels: `development`, `preview`, and `production`.
  - Xcode Cloud iOS builds are non-EAS CNG builds, so `app.config.js` writes `updates.requestHeaders["expo-channel-name"]`.

`appVersion` is intentionally used instead of `fingerprint`. Fingerprint is safer for automatically separating native runtime changes, but it depends on hashing the build/update project state. Because iOS store builds are produced by Xcode Cloud while updates may be published from a developer machine or another CI job, the simplest stable contract is that all builds and updates for the same `expo.version` share the same runtime. When native dependencies, config plugins, native config, SDK version, or generated native behavior changes, bump `expo.version` and ship new native builds before publishing updates for that runtime.

## Channel environment variables

`app.config.js` resolves the channel in this order:

1. `EXPO_UPDATES_CHANNEL`, when set.
2. `EXPO_PUBLIC_APP_ENV=production` -> `production`.
3. `EXPO_PUBLIC_APP_ENV=preview` -> `preview`.
4. Anything else -> `development`.

EAS Build also injects the channel from `eas.json` at build time. Keep the values aligned; the fallback mapping above matches the EAS profiles.

Xcode Cloud workflows must define:

| Workflow | `EXPO_PUBLIC_APP_ENV` | `EXPO_UPDATES_CHANNEL` |
| --- | --- | --- |
| TestFlight production/main | `production` | `production` |
| Preview/internal, if added | `preview` | `preview` |
| Development, if added | `development` | `development` |

Production Xcode Cloud workflows must also keep the existing store-build guard satisfied: `EXPO_PUBLIC_API_MODE=live`, no `EXPO_PUBLIC_QA_TOUR=1`, and any `EXPO_PUBLIC_API_URL` must be HTTPS.

No Xcode Cloud script changes are required. `scripts/xcode-cloud/ci_post_clone.sh` already runs `npm ci` and `npx expo prebuild --platform ios --clean --no-install`; once the workflow environment variables above are present, prebuild will embed the correct Expo.plist update URL, runtime version, and channel header.

## Publishing

Preview:

```sh
eas update --channel preview --message "Describe the change" --environment preview
```

Production:

```sh
eas update --channel production --message "Describe the change" --environment production
```

Use the same source commit and environment values that match the intended build channel. In SDK 55 and later, `--environment` is required by the EAS Update flow.

## Rollback

Prefer the EAS dashboard when available: open the project, go to Updates, choose the channel/branch, and roll back or republish the last known-good update.

CLI fallback:

```sh
eas update:republish --channel production --group <known-good-update-group-id>
eas update:rollback <bad-latest-update-group-id> --message "Rollback bad OTA"
```

Use the matching channel (`preview` or `production`) and verify the update group targets the same platform and runtime version.

## When a new native build is required

Create new Android and iOS builds before OTA when a change modifies native code or native configuration, including:

- adding, removing, or upgrading native modules
- changing Expo SDK, React Native, config plugins, permissions, entitlements, URL schemes, associated domains, app icons/splash native assets, build properties, or Info.plist/AndroidManifest values
- changing `expo.version`, because the runtime version policy follows it

After the new builds are installed or released, publish OTA updates for the new runtime on the appropriate channel.
