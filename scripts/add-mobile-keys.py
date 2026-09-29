#!/usr/bin/env python3
"""Merge mobile-only translation keys: add-mobile-keys.py '{"key": ["tr", "en"], ...}'"""
import json, sys, collections
pairs = json.loads(sys.argv[1])
for i, loc in enumerate(['tr', 'en']):
    p = f'src/locales/mobile/{loc}.json'
    d = json.load(open(p), object_pairs_hook=collections.OrderedDict)
    for k, v in pairs.items():
        d[k] = v[i]
    json.dump(d, open(p, 'w'), ensure_ascii=False, indent=2)
    open(p, 'a').write('\n')
print(f'added {len(pairs)} keys')
