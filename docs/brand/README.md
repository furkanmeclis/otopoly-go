# Otopoly logo

`logo-pack/` is the source of truth (designer export, Nov 2026):

| File | Use |
|------|-----|
| `Icon - *` | OP mark on a 2000×2000 artboard (app icons) |
| `Logo - *` | Vertical lockup (mark above OTOPOLY) |
| `Logo 2 - *` | Horizontal lockup (mark + OTOPOLY) |

Variants: `Colorful` (cream background), `Dark` (espresso background, outlined O tile), `Black` / `White` (single colour).

Colours: terracotta `#E26B41`, espresso `#2B201A`, cream `#FEF9F5`.

## Where it is used

- Web: `frontend/src/components/brand/artwork.ts` holds the normalized geometry; `AppMark` / `AppWordmark` theme it (light = filled espresso O tile, dark = cream outline). Pin a variant on fixed backgrounds with `tone="light" | "dark"`. `app/icon.svg` and `app/apple-icon.png` are generated.
- Mobile: every PNG under `mobile/assets/` (icons, adaptive icon layers, splash mark, widget tile) is generated. Changing them changes the native fingerprint, so the next release ships a store build instead of an OTA update.

## Regenerating

```bash
cd docs/brand/scripts
python3 -I normalize.py /tmp/geo.json "../logo-pack/Otopoly - Logo 2 - Colorful.svg"
python3 -I render.py /tmp/geo.json ../logo-pack ../../.. /tmp/brand-out
```

`render.py` needs `rsvg-convert` (`brew install librsvg`). `python3 -I write_artwork.py /tmp/geo.json ../../../frontend/src/components/brand/artwork.ts` rewrites the web geometry (run prettier after); `generated/` keeps the tight light/dark SVGs for design use.
