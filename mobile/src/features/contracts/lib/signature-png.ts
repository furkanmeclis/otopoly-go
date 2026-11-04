/**
 * Rasterizes signature strokes into a PNG (transparent background, black ink) without native modules.
 * The backend expects `signature_png_base64` (web: SignaturePad `toDataURL()`), so the image is encoded
 * in plain JS: 1-bit palette PNG + uncompressed ("stored") deflate blocks. A 600×200 pad is ~15 KB.
 */

export type Point = { x: number; y: number };
export type Stroke = Point[];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

class ByteWriter {
  private buf: number[] = [];
  u8(v: number) {
    this.buf.push(v & 0xff);
  }
  u16le(v: number) {
    this.u8(v);
    this.u8(v >>> 8);
  }
  u32be(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  bytes(arr: ArrayLike<number>) {
    for (let i = 0; i < arr.length; i++) this.buf.push(arr[i] & 0xff);
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  get length() {
    return this.buf.length;
  }
  toUint8() {
    return Uint8Array.from(this.buf);
  }
}

function chunk(out: ByteWriter, type: string, data: Uint8Array) {
  out.u32be(data.length);
  const body = new ByteWriter();
  body.ascii(type);
  body.bytes(data);
  const bytes = body.toUint8();
  out.bytes(bytes);
  out.u32be(crc32(bytes, 0, bytes.length));
}

function zlibStored(raw: Uint8Array) {
  const out = new ByteWriter();
  out.u8(0x78);
  out.u8(0x01);
  const MAX = 65535;
  let pos = 0;
  do {
    const len = Math.min(MAX, raw.length - pos);
    out.u8(pos + len >= raw.length ? 1 : 0); // BFINAL, BTYPE=00 (stored)
    out.u16le(len);
    out.u16le(~len & 0xffff);
    out.bytes(raw.subarray(pos, pos + len));
    pos += len;
  } while (pos < raw.length);
  out.u32be(adler32(raw));
  return out.toUint8();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return s;
}

/** Encodes a 1-bit bitmap (row-major, 1 = ink) as PNG bytes. */
export function encodeBitmapPng(width: number, height: number, ink: Uint8Array) {
  const rowBytes = Math.ceil(width / 8);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) raw[rowStart + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const out = new ByteWriter();
  out.bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new ByteWriter();
  ihdr.u32be(width);
  ihdr.u32be(height);
  ihdr.bytes([1, 3, 0, 0, 0]); // bit depth 1, palette, deflate, no filter, no interlace
  chunk(out, 'IHDR', ihdr.toUint8());
  chunk(out, 'PLTE', Uint8Array.from([255, 255, 255, 0, 0, 0]));
  chunk(out, 'tRNS', Uint8Array.from([0, 255])); // index 0 transparent, ink opaque
  chunk(out, 'IDAT', zlibStored(raw));
  chunk(out, 'IEND', new Uint8Array(0));
  return out.toUint8();
}

/**
 * Draws the strokes (captured in a `viewWidth × viewHeight` pad) into a bitmap `outWidth` wide and returns
 * a `data:image/png;base64,…` URL — the same shape the web SignaturePad produces.
 */
export function strokesToPngDataUrl(strokes: Stroke[], viewWidth: number, viewHeight: number, outWidth = 600, penWidth = 2.5) {
  const scale = outWidth / Math.max(viewWidth, 1);
  const width = Math.max(1, Math.round(viewWidth * scale));
  const height = Math.max(1, Math.round(viewHeight * scale));
  const ink = new Uint8Array(width * height);
  const r = Math.max(1, penWidth * scale * 0.5 + 0.5);
  const r2 = r * r;

  const stamp = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) ink[y * width + x] = 1;
      }
    }
  };

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    let prev = stroke[0];
    stamp(prev.x * scale, prev.y * scale);
    for (let i = 1; i < stroke.length; i++) {
      const p = stroke[i];
      const dx = (p.x - prev.x) * scale;
      const dy = (p.y - prev.y) * scale;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(r * 0.5, 0.5)));
      for (let s = 1; s <= steps; s++) stamp(prev.x * scale + (dx * s) / steps, prev.y * scale + (dy * s) / steps);
      prev = p;
    }
  }

  return `data:image/png;base64,${toBase64(encodeBitmapPng(width, height, ink))}`;
}
