#!/usr/bin/env node
// Bundles and runs every mock smoke suite (mock-smoke.ts + scripts/smoke/*.smoke.ts) with the
// same esbuild settings as `npm run test:mock`. Exits non-zero if any suite fails.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const dir = path.join(root, 'scripts/smoke');
const out = path.join(root, 'node_modules/.cache/smoke');
fs.mkdirSync(out, { recursive: true });
const suites = ['mock-smoke.ts', ...fs.readdirSync(dir).filter((f) => f.endsWith('.smoke.ts')).sort()];
const stub = './scripts/smoke/stubs.js';
let failed = 0;
for (const suite of suites) {
  const bundle = path.join(out, suite.replace(/\.ts$/, '.cjs'));
  try {
    execFileSync('npx', ['esbuild', path.join('scripts/smoke', suite), '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`,
      '--tsconfig=tsconfig.json', '--define:__DEV__=false', `--define:process.env.EXPO_PUBLIC_MOCK_LATENCY="0"`,
      `--alias:@react-native-async-storage/async-storage=${stub}`, `--alias:expo-secure-store=${stub}`, `--alias:expo-localization=${stub}`,
      '--log-level=warning'], { cwd: root, stdio: 'inherit' });
    const res = execFileSync('node', [bundle], { cwd: root, encoding: 'utf8' });
    const last = res.trim().split('\n').pop();
    console.log(`✔ ${suite}: ${last}`);
  } catch (error) {
    failed++;
    console.error(`✖ ${suite} failed`);
    if (error.stdout) console.error(String(error.stdout).split('\n').slice(-15).join('\n'));
    if (error.stderr) console.error(String(error.stderr).split('\n').slice(-15).join('\n'));
  }
}
console.log(failed ? `${failed} suite(s) failed` : `ALL ${suites.length} SUITES PASSED`);
process.exit(failed ? 1 : 0);
