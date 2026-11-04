/* Store build gating smoke test: with EXPO_PUBLIC_APP_ENV=production the app config must force live
 * mode and switch off every demo / QA / diagnostics path, even if the environment asks for mock mode
 * or the QA tour. Run via `npm run test:smoke`. */
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};

async function main() {
  // Set before the module is evaluated (the dynamic import below is bundled as a lazy module).
  process.env.EXPO_PUBLIC_APP_ENV = 'production';
  process.env.EXPO_PUBLIC_API_MODE = 'mock';
  process.env.EXPO_PUBLIC_QA_TOUR = '1';
  process.env.EXPO_PUBLIC_WEB_URL = 'http://192.168.1.5:3000';
  delete process.env.EXPO_PUBLIC_API_URL;
  delete process.env.EXPO_PUBLIC_PRIVACY_URL;
  process.env.EXPO_PUBLIC_TERMS_URL = 'http://insecure.example/terms';

  const mod = await import('@/config/env');
  ok(mod.isStoreBuild, 'production app env is a store build');
  ok(!mod.isMock && mod.env.apiMode === 'live', 'store build ignores EXPO_PUBLIC_API_MODE=mock');
  ok(!mod.qaTourEnabled && !mod.env.qaTour, 'store build ignores EXPO_PUBLIC_QA_TOUR');
  ok(!mod.devToolsEnabled, 'diagnostics are unreachable');
  ok(mod.env.webHost === null, 'dev web host is not accepted by the QR scanner');
  ok(mod.env.apiUrl === 'https://api.otopoly.app', 'live API defaults to https://api.otopoly.app');
  ok(mod.env.privacyUrl === 'https://otopoly.app/privacy', 'privacy URL default');
  ok(mod.env.termsUrl === 'https://otopoly.app/terms', 'non-https terms URL falls back to the default');

  console.log(failures ? `${failures} STORE BUILD CHECK(S) FAILED` : 'all store build checks passed');
  process.exit(failures ? 1 : 0);
}

void main();
