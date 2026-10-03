#!/usr/bin/env node
/**
 * Contract test: proves the mock API and the feature services match the Go API's OpenAPI spec without a backend.
 *
 * 1. Bundles the contract driver (scripts/contract/drive.ts, calls the real feature services per area) and every
 *    mock smoke suite with the smoke esbuild settings, plus a recorder that wraps the API transport.
 * 2. Runs each bundle; every request/response pair is recorded.
 * 3. Validates the records against scripts/contract/openapi.yaml (validate.mjs) and prints coverage.
 *
 * Exits non-zero on any contract violation (or if the driver itself fails).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { build } from 'esbuild';

import { validateRecords } from './validate.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'node_modules/.cache/contract');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const stub = path.join(root, 'scripts/smoke/stubs.js');
const filesStub = path.join(root, 'scripts/contract/stubs-files.js');

/** Routes every transport through the recorder (globalThis.__contractWrap__, see recorder.js). */
const recorderPlugin = {
  name: 'contract-recorder',
  setup(b) {
    const patch = (file, from, to) => {
      b.onLoad({ filter: new RegExp(`${file.replace(/[/.]/g, (c) => `\\${c}`)}$`) }, async (args) => {
        const src = await fs.promises.readFile(args.path, 'utf8');
        if (!src.includes(from)) throw new Error(`contract recorder: anchor not found in ${file}: ${from}`);
        return { contents: src.replace(from, to), loader: 'ts' };
      });
    };
    patch('src/api/client.ts', 'transport = next;', 'transport = globalThis.__contractWrap__ ? globalThis.__contractWrap__(next) : next;');
    patch(
      'src/api/mock/index.ts',
      'const res = await mockTransport({ method, path, body: fields',
      'const res = await (globalThis.__contractWrap__ ? globalThis.__contractWrap__(mockTransport, true) : mockTransport)({ method, path, body: fields',
    );
  },
};

async function bundle(entry, outfile) {
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { __DEV__: 'false', 'process.env.EXPO_PUBLIC_MOCK_LATENCY': '"0"' },
    alias: {
      '@react-native-async-storage/async-storage': stub,
      'expo-secure-store': stub,
      'expo-localization': stub,
      'expo-file-system': filesStub,
      'expo-sharing': filesStub,
    },
    inject: [path.join(root, 'scripts/contract/recorder.js')],
    plugins: [recorderPlugin],
    logLevel: 'warning',
  });
}

const smokeDir = path.join(root, 'scripts/smoke');
const suites = [
  { name: 'drive', entry: 'scripts/contract/drive.ts', required: true },
  { name: 'mock-smoke', entry: 'scripts/smoke/mock-smoke.ts' },
  ...fs
    .readdirSync(smokeDir)
    .filter((f) => f.endsWith('.smoke.ts'))
    .sort()
    .map((f) => ({ name: f.replace(/\.smoke\.ts$/, ''), entry: `scripts/smoke/${f}` })),
];

const all = [];
let routes = [];
let driverFailed = false;
for (const suite of suites) {
  const file = path.join(out, `${suite.name}.cjs`);
  const recordsFile = path.join(out, `${suite.name}.json`);
  await bundle(suite.entry, file);
  try {
    const res = execFileSync('node', [file], { cwd: root, encoding: 'utf8', env: { ...process.env, CONTRACT_OUT: recordsFile } });
    if (suite.required) process.stdout.write(res.split('\n').filter((l) => /✗|FAIL/.test(l)).join('\n'));
  } catch (error) {
    console.error(`✖ ${suite.name} exited with an error`);
    console.error(String(error.stdout ?? '').split('\n').slice(-20).join('\n'));
    console.error(String(error.stderr ?? '').split('\n').slice(-20).join('\n'));
    if (suite.required) driverFailed = true;
  }
  if (!fs.existsSync(recordsFile)) continue;
  const data = JSON.parse(fs.readFileSync(recordsFile, 'utf8'));
  for (const r of data.records) all.push({ ...r, suite: suite.name });
  if (data.routes?.length) routes = data.routes;
}

const result = validateRecords({
  specPath: path.join(root, 'scripts/contract/openapi.yaml'),
  allowlistPath: path.join(root, 'scripts/contract/allowlist.json'),
  errorCodesPath: path.join(root, 'scripts/contract/backend-error-codes.json'),
  backendRoutesPath: path.join(root, 'scripts/contract/backend-routes.json'),
  records: all,
  routes,
  verbose: process.argv.includes('--verbose'),
});
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(result.report, null, 2));
process.exit(result.ok && !driverFailed ? 0 : 1);
