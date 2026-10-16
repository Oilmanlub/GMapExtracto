// One-shot icon generator: writes icons/icon{16,32,48,128}.png (map-pin on a
// blue->green gradient). No dependencies: PNG is hand-encoded via zlib.
// Run: node tools/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BLUE = [26, 115, 232];
const GREEN = [52, 168, 83];
const lerp = (a, b, t) => a + (b - a) * t;

// returns [r,g,b,a] for a point in 0..1 space
function shade(u, v) {
  const S = 1;
  const cx = 0.5, headY = 0.42, R = 0.26;
  const holeR = R * 0.42;
  const apexY = 0.86;
  // rounded square mask
  const r = 0.22;
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];

  const grad = [lerp(BLUE[0], GREEN[0], (u + v) / 2), lerp(BLUE[1], GREEN[1], (u + v) / 2), lerp(BLUE[2], GREEN[2], (u + v) / 2)];

  const dHead = Math.hypot(u - cx, v - headY);
  let pin = dHead <= R;
  if (!pin && v >= headY && v <= apexY) {
    const halfW = R * (1 - (v - headY) / (apexY - headY));
    pin = Math.abs(u - cx) <= halfW;
  }
  if (pin && dHead > holeR) return [255, 255, 255, 255];
  if (pin && dHead <= holeR) return [grad[0], grad[1], grad[2], 255];
  return [grad[0], grad[1], grad[2], 255];
}

function render(size, SS) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          const cov = c[3] / 255;
          r += c[0] * cov; g += c[1] * cov; b += c[2] * cov; a += c[3];
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const w = alpha > 0 ? 255 / alpha : 0;
      const i = (y * size + x) * 4;
      out[i] = Math.round((r / n) * w);
      out[i + 1] = Math.round((g / n) * w);
      out[i + 2] = Math.round((b / n) * w);
      out[i + 3] = Math.round(alpha);
    }
  }
  return encodePNG(size, size, out);
}

const dir = path.join(__dirname, "..", "icons");
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = render(size, 4);
  const file = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(file, png);
  const sig = png.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (!sig || w !== size || h !== size) throw new Error("bad PNG " + file);
  console.log(`wrote ${path.relative(process.cwd(), file)} (${w}x${h}, ${png.length} bytes)`);
}
console.log("icons OK");
