#!/usr/bin/env node
/**
 * Structural 3-way merge of two OpenAPI documents that forked from a common base (used by refresh-spec.sh).
 * A line-based merge of a 15k-line YAML can splice a block into the wrong mapping without reporting a
 * conflict; merging the parsed trees cannot. Per node: one side changed → take it; both changed → recurse
 * into objects, union arrays of scalars, otherwise keep "ours" and report the conflict on stderr.
 *
 * Usage: node scripts/contract/merge-spec.mjs ours.yaml base.yaml theirs.yaml > merged.yaml
 */
import fs from 'node:fs';

import YAML from 'yaml';

const [oursPath, basePath, theirsPath] = process.argv.slice(2);
if (!theirsPath) {
  console.error('usage: merge-spec.mjs ours.yaml base.yaml theirs.yaml');
  process.exit(2);
}
const load = (p) => YAML.parse(fs.readFileSync(p, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const conflicts = [];

function merge(ours, base, theirs, path) {
  if (same(ours, theirs)) return ours;
  if (same(base, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const inO = k in ours;
      const inT = k in theirs;
      if (inO && inT) out[k] = merge(ours[k], b[k], theirs[k], `${path}/${k}`);
      else if (inO) {
        // Deleted by theirs (present in base, untouched by ours) → drop; otherwise added by ours.
        if (k in b && same(b[k], ours[k])) continue;
        out[k] = ours[k];
      } else {
        if (k in b && same(b[k], theirs[k])) continue;
        out[k] = theirs[k];
      }
    }
    return out;
  }
  if (Array.isArray(ours) && Array.isArray(theirs) && [...ours, ...theirs].every((v) => !isObj(v) && !Array.isArray(v))) {
    return [...new Set([...ours, ...theirs])];
  }
  // A write that both branches touched: the plan-limit refusal (theirs) is the more specific 409.
  if (path.endsWith('/409/$ref') && theirs === '#/components/responses/LimitReached') {
    console.error(`resolved: ${path} → LimitReached (was ${ours})`);
    return theirs;
  }
  conflicts.push(path);
  return ours;
}

const merged = merge(load(oursPath), load(basePath), load(theirsPath), '');
for (const c of conflicts) console.error(`conflict (kept ours): ${c}`);
if (conflicts.length && process.env.STRICT_MERGE === '1') process.exit(1);
process.stdout.write(YAML.stringify(merged, { lineWidth: 0 }));
