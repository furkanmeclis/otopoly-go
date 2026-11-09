"""Normalize Otopoly logo-pack geometry: bake translate() into absolute path coords.

Usage: python3 -I normalize.py <out.json>
Emits mark + wordmark parts with viewBox origin at (0,0).
"""
import json
import re
import sys

TOK = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?")
ARGC = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def fmt(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def shift(d: str, dx: float, dy: float) -> str:
    toks = TOK.findall(d)
    out, i, cmd = [], 0, None
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            out.append(cmd)
            if cmd in "Zz":
                continue
        n = ARGC[cmd.upper()]
        args = [float(x) for x in toks[i : i + n]]
        i += n
        if cmd.isupper():
            if cmd == "H":
                args[0] += dx
            elif cmd == "V":
                args[0] += dy
            elif cmd == "A":
                args[5] += dx
                args[6] += dy
            else:
                for k in range(0, n, 2):
                    args[k] += dx
                    args[k + 1] += dy
        out.append(",".join(fmt(a) for a in args))
        # implicit repeat: M -> L
        if cmd == "M":
            cmd = "L"
        elif cmd == "m":
            cmd = "l"
    # join: command letters followed directly by args
    s = ""
    for part in out:
        if part.isalpha():
            s += part
        else:
            s += (part if s and s[-1].isalpha() else " " + part)
    return s.strip()


def rect(x, y, w, h, r, dx, dy):
    x, y = x + dx, y + dy
    return {"x": fmt(x), "y": fmt(y), "width": fmt(w), "height": fmt(h), "rx": fmt(r)}


PAD = 10  # room for the 20px outline stroke in the dark variant

# --- Mark (from "Icon - Colorful", 2000x2000 artboard) ---
mx, my = -(404 - PAD), -(657 - PAD)
mark = {
    "viewBox": f"0 0 {fmt(1596 - 404 + 2 * PAD)} {fmt(1342.91 - 657 + 2 * PAD)}",
    "tile": shift(
        "M487.623,657H904.218a83.622,83.622,0,0,1,83.622,83.622v518.665a83.622,83.622,0,0,1-83.622,83.622H487.623A83.623,83.623,0,0,1,404,1259.287V740.623A83.623,83.623,0,0,1,487.623,657Z",
        mx, my),
    "accent": rect(1012.16, 657, 583.84, 685.91, 83.622, mx, my),
    "o": shift(
        "M2820.92,898.817a120.147,120.147,0,1,1-120.11,120.153A120.133,120.133,0,0,1,2820.92,898.817Zm0-89.731c115.88,0,209.81,93.966,209.81,209.884s-93.93,209.88-209.81,209.88-209.82-93.97-209.82-209.88S2705.04,809.086,2820.92,809.086Z",
        mx - 2125, my),
    "p": shift(
        "M3356.1,1014.13s36.4,0.27,72.98.27,62.34-25.57,62.34-59.311-28.32-51.884-57.78-51.884H3356.1V1014.13Zm0,88.25v126.47h-97.3V809.086h177.88c60.63,0,149,40.652,149,138.4s-77.33,155.125-152.04,155.125S3356.1,1102.38,3356.1,1102.38Z",
        mx - 2125, my),
    "star": shift(
        "M3534,764.216q58.86-8.8,67.65-67.7,8.8,58.895,67.65,67.7-58.845,8.8-67.65,67.695Q3592.86,773.017,3534,764.216Z",
        mx - 2125, my),
    "stroke": 20,
}

# --- Horizontal lockup (from "Logo 2 - Colorful", 3090x2000 artboard) ---
wx, wy = -(253 - PAD), -(744 - PAD)
wordmark = {
    "viewBox": f"0 0 {fmt(2837.49 - 253 + 2 * PAD)} {fmt(1256 - 744 + 2 * PAD)}",
    "tile": None,
    "accent": None,
    "stroke": 20,
}
T = -4388
wordmark["text"] = shift(
    re.search(r'id="OTOPOLY"[^>]* d="([^"]+)"', open(sys.argv[2]).read()).group(1),
    wx + T, wy)
wordmark["tile"] = rect(253, 744, 435.41, 512, 62.363, wx, wy)
wordmark["accent"] = shift(
    "M5156.91,744h310.68a62.4,62.4,0,0,1,62.36,62.439V1193.56a62.4,62.4,0,0,1-62.36,62.44H5156.91a62.4,62.4,0,0,1-62.36-62.44V806.439A62.4,62.4,0,0,1,5156.91,744Z",
    wx + T, wy)
wordmark["o"] = shift(
    "M4858.7,924.489a89.691,89.691,0,1,1-89.56,89.691A89.628,89.628,0,0,1,4858.7,924.489Zm0-66.978c86.44,0,156.5,70.142,156.5,156.669s-70.06,156.66-156.5,156.66-156.5-70.14-156.5-156.66S4772.27,857.511,4858.7,857.511Z",
    wx + T, wy)
wordmark["p"] = shift(
    "M5257.82,1010.59s27.15,0.2,54.43.2,46.49-19.093,46.49-44.279-21.12-38.729-43.09-38.729h-57.83v82.808Zm0,65.87v94.4h-72.56V857.526h132.66c45.22,0,111.12,30.345,111.12,103.309s-57.68,115.8-113.39,115.8S5257.82,1076.46,5257.82,1076.46Z",
    wx + T, wy)
wordmark["star"] = shift(
    "M5390.5,824.032q43.89-6.57,50.45-50.533,6.555,43.963,50.45,50.533-43.89,6.568-50.45,50.532Q5434.4,830.6,5390.5,824.032Z",
    wx + T, wy)

json.dump({"mark": mark, "wordmark": wordmark}, open(sys.argv[1], "w"), indent=1)
print("ok", mark["viewBox"], wordmark["viewBox"])
