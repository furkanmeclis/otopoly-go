"""Build Otopoly brand SVGs/PNGs from the normalized geometry (geo.json) and the logo pack.

Usage: python3 -I render.py <geo.json> <pack_svg_dir> <repo_root> <work_dir>
Requires rsvg-convert on PATH.
"""
import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

geo = json.load(open(sys.argv[1]))
PACK = Path(sys.argv[2])
REPO = Path(sys.argv[3])
WORK = Path(sys.argv[4])
WORK.mkdir(parents=True, exist_ok=True)

ESPRESSO, CREAM, ACCENT, WHITE = "#2b201a", "#fef9f5", "#e26b41", "#fff"


def rect_el(r, attrs):
    return f'<rect x="{r["x"]}" y="{r["y"]}" width="{r["width"]}" height="{r["height"]}" rx="{r["rx"]}" {attrs}/>'


def shape(part, attrs):
    return rect_el(part, attrs) if isinstance(part, dict) else f'<path d="{part}" {attrs}/>'


def body(g, tone):
    """Inner elements for tone light (filled espresso tile) or dark (cream outline tile)."""
    if tone == "light":
        tile, o, text = f'fill="{ESPRESSO}"', f'fill="{WHITE}"', f'fill="{ESPRESSO}"'
    else:
        tile = f'fill="none" stroke="{CREAM}" stroke-width="{g["stroke"]}"'
        o, text = f'fill="{CREAM}"', f'fill="{CREAM}"'
    out = [
        shape(g["tile"], tile),
        shape(g["accent"], f'fill="{ACCENT}"'),
        f'<path d="{g["o"]}" fill-rule="evenodd" {o}/>',
        f'<path d="{g["p"]}" fill-rule="evenodd" fill="{WHITE}"/>',
        f'<path d="{g["star"]}" fill="{WHITE}"/>',
    ]
    if "text" in g:
        out.insert(0, f'<path d="{g["text"]}" fill-rule="evenodd" {text}/>')
    return "".join(out)


def svg(view_box, inner, extra=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"{extra}>{inner}</svg>\n'


def vb(g):
    _, _, w, h = (float(v) for v in g["viewBox"].split())
    return w, h


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def png(src, dst, width=None, height=None):
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["rsvg-convert", str(src), "-o", str(dst)]
    if width:
        cmd += ["-w", str(width)]
    if height:
        cmd += ["-h", str(height)]
    subprocess.run(cmd, check=True)
    return dst


# --- minimal PNG RGBA -> RGB (drop alpha over a solid background) ---
def _unfilter(raw, w, h, bpp):
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return out


def _chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def flatten_rgb(path, bg_hex):
    data = path.read_bytes()
    pos, idat, w = 8, b"", None
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        body_ = data[pos + 8 : pos + 8 + ln]
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body_[:10])
            if ctype == 2:
                return
            assert depth == 8 and ctype == 6, (depth, ctype)
        elif tag == b"IDAT":
            idat += body_
        pos += 12 + ln
    px = _unfilter(zlib.decompress(idat), w, h, 4)
    br, bgc, bb = (int(bg_hex[i : i + 2], 16) for i in (1, 3, 5))
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            r, g, b, a = px[(y * w + x) * 4 : (y * w + x) * 4 + 4]
            rows += bytes(((r * a + br * (255 - a)) // 255, (g * a + bgc * (255 - a)) // 255, (b * a + bb * (255 - a)) // 255))
    out = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    out += _chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + _chunk(b"IEND", b"")
    path.write_bytes(out)


M, W = geo["mark"], geo["wordmark"]
mw, mh = vb(M)

# Tight marks (transparent)
mark_light = write(WORK / "mark-light.svg", svg(M["viewBox"], body(M, "light")))
mark_dark = write(WORK / "mark-dark.svg", svg(M["viewBox"], body(M, "dark")))
write(WORK / "wordmark-light.svg", svg(W["viewBox"], body(W, "light")))
write(WORK / "wordmark-dark.svg", svg(W["viewBox"], body(W, "dark")))


def centered(canvas, mark_width, inner, bg=None):
    s = mark_width / mw
    tx, ty = (canvas - mw * s) / 2, (canvas - mh * s) / 2
    bg_el = f'<rect width="{canvas}" height="{canvas}" fill="{bg}"/>' if bg else ""
    return svg(f"0 0 {canvas} {canvas}", f'{bg_el}<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.6f})">{inner}</g>')


# Android adaptive icon: mark inside the 66dp safe circle of a 108dp canvas.
fg = write(WORK / "android-fg.svg", centered(1024, 540, body(M, "light")))
mono_inner = (
    '<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="2000" height="2000">'
    f'{shape(M["tile"], "fill=\"#fff\"")}{shape(M["accent"], "fill=\"#fff\"")}'
    f'<path d="{M["o"]}" fill-rule="evenodd" fill="#000"/><path d="{M["p"]}" fill-rule="evenodd" fill="#000"/>'
    f'<path d="{M["star"]}" fill="#000"/></mask></defs>'
    f'<rect width="{mw}" height="{mh}" fill="#fff" mask="url(#m)"/>'
)
mono = write(WORK / "android-mono.svg", centered(1024, 540, mono_inner))

# Browser favicon: square, follows the tab bar colour scheme.
side = mw
fav_inner = (
    "<style>.t{fill:%s}.o{fill:#fff}@media (prefers-color-scheme:dark){.t{fill:none;stroke:%s;stroke-width:%d}.o{fill:%s}}</style>"
    % (ESPRESSO, CREAM, 28, CREAM)
)
fav_inner += f'<g transform="translate(0 {(side - mh) / 2:.2f})">'
fav_inner += shape(M["tile"], 'class="t"') + shape(M["accent"], f'fill="{ACCENT}"')
fav_inner += f'<path class="o" d="{M["o"]}" fill-rule="evenodd"/>'
fav_inner += f'<path d="{M["p"]}" fill-rule="evenodd" fill="{WHITE}"/><path d="{M["star"]}" fill="{WHITE}"/></g>'
favicon = write(WORK / "favicon.svg", svg(f"0 0 {side:g} {side:g}", fav_inner))

icon_colorful = PACK / "Otopoly - Icon - Colorful.svg"
icon_dark = PACK / "Otopoly - Icon - Dark.svg"

# --- Mobile ---
MA = REPO / "mobile/assets"
for out, src, w, flat in [
    (MA / "icon.png", icon_colorful, 1024, CREAM),
    (MA / "AppIcon.icon/Assets/icon.png", icon_colorful, 1024, None),
    (MA / "android-icon-foreground.png", fg, 1024, None),
    (MA / "android-icon-monochrome.png", mono, 1024, None),
    (MA / "brand/app-icon.png", icon_colorful, 512, CREAM),
    (MA / "brand/widget-tile.png", icon_colorful, 240, CREAM),
    (MA / "favicon.png", icon_colorful, 48, CREAM),
    (MA / "splash-icon.png", fg, 1024, None),
    (MA / "brand/mark.png", mark_light, 960, None),
    (MA / "brand/mark-dark.png", mark_dark, 960, None),
]:
    png(src, out, width=w)
    if flat:
        flatten_rgb(out, flat)

bg = write(WORK / "android-bg.svg", svg("0 0 1024 1024", f'<rect width="1024" height="1024" fill="{CREAM}"/>'))
png(bg, MA / "android-icon-background.png", width=1024)
flatten_rgb(MA / "android-icon-background.png", CREAM)

# --- Web ---
FE = REPO / "frontend/src/app"
(FE / "icon.svg").write_text(favicon.read_text())
png(icon_colorful, FE / "apple-icon.png", width=180)
flatten_rgb(FE / "apple-icon.png", CREAM)

print("mark ratio", mw / mh)
