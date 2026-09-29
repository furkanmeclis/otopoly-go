#!/usr/bin/env node
// Verifies every literal translation key used in src/ exists in both tr and en catalogs.
// Usage: node scripts/check-i18n.mjs   (exit 1 on missing keys)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const locales = ['tr', 'en'];

function loadCatalog(locale) {
  const dir = path.join(root, 'src/locales', locale);
  const out = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  out.mobile = JSON.parse(fs.readFileSync(path.join(root, 'src/locales/mobile', `${locale}.json`), 'utf8'));
  return out;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['locales', 'generated', 'mock'].includes(entry.name)) walk(p, files);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(p);
  }
  return files;
}

const catalogs = Object.fromEntries(locales.map((l) => [l, loadCatalog(l)]));
const has = (locale, key) => {
  const dot = key.indexOf('.');
  const ns = catalogs[locale][key.slice(0, dot)];
  return ns ? Object.hasOwn(ns, key.slice(dot + 1)) : false;
};

// t('ns.key'), tr('ns.key'), tp('ns.key', n) — plural keys checked with _one/_other.
const re = /\b(t|tr|tp)\(\s*['"`]([a-z_]+\.[A-Za-z0-9_.]+)['"`]/g;
const missing = [];
for (const file of walk(path.join(root, 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(re)) {
    const [, fn, key] = m;
    const keys = fn === 'tp' ? [`${key}_one`, `${key}_other`] : [key];
    for (const k of keys) for (const l of locales) if (!has(l, k)) missing.push(`${l}  ${k}  (${path.relative(root, file)})`);
  }
}

if (missing.length) {
  console.error(`Missing translation keys (${missing.length}):\n${[...new Set(missing)].join('\n')}`);
  process.exit(1);
}
console.log('i18n: all literal keys resolve in tr and en');
