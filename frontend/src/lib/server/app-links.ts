/**
 * Universal Links (iOS) and App Links (Android) for the Otopoly mobile app.
 * Served from the web origin at /.well-known/* so web URLs open the app:
 *   /t/*        tenant screens (notification data.url uses these paths)
 *   /q/*        public quote share links
 *   /login/qr/* QR login handoff
 *
 * Read at request time (runtime env, not baked into the image):
 *   APPLE_TEAM_ID                     Apple Developer Team ID (10 chars)
 *   IOS_BUNDLE_ID                     default com.otopoly.app
 *   ANDROID_PACKAGE_NAME              default com.otopoly.app
 *   ANDROID_SHA256_CERT_FINGERPRINTS  comma-separated SHA-256 signing cert
 *                                     fingerprints (AA:BB:…), e.g. the Play
 *                                     App Signing key + upload/EAS key
 */

export const APP_LINK_PATHS = ["/t/*", "/q/*", "/login/qr/*"] as const;

const DEFAULT_APP_ID = "com.otopoly.app";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function iosAppId(): string | null {
  const team = env("APPLE_TEAM_ID");
  if (!/^[A-Z0-9]{10}$/.test(team)) return null;
  return `${team}.${env("IOS_BUNDLE_ID") || DEFAULT_APP_ID}`;
}

export function appleAppSiteAssociation(appId: string) {
  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: APP_LINK_PATHS.map((path) => ({ "/": path })),
        },
      ],
    },
    webcredentials: { apps: [appId] },
  };
}

export function androidFingerprints(): string[] {
  return env("ANDROID_SHA256_CERT_FINGERPRINTS")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v));
}

export function assetLinks(fingerprints: string[]) {
  return [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: env("ANDROID_PACKAGE_NAME") || DEFAULT_APP_ID,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/** JSON response for the association files: no redirect, cacheable. */
export function associationResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control":
        status === 200 ? "public, max-age=3600" : "no-store",
    },
  });
}
