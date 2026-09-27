// Photo in, pencil sketch out. Knows nothing about the page.

const PAPER = [244, 241, 234];
const DARK = [38, 38, 42];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function boxBlur(src, w, h, r, passes) {
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[o + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[o + x] = s / win;
        s += a[o + clamp(x + r + 1, 0, w - 1)] - a[o + clamp(x - r, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / win;
        s += b[clamp(y + r + 1, 0, h - 1) * w + x] - b[clamp(y - r, 0, h - 1) * w + x];
      }
    }
  }
  return a;
}

// Many short strokes in one direction, read back as a 0..1 darkness map.
function hatch(w, h, angle, density) {
  const c = newCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, w, h);
  x.lineCap = 'round';
  const n = Math.round((w * h) / density);
  for (let i = 0; i < n; i++) {
    const a = angle + (Math.random() - 0.5) * 0.3;
    const len = ((14 + Math.random() * 46) * w) / 700;
    const px = Math.random() * w;
    const py = Math.random() * h;
    x.strokeStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.4})`;
    x.lineWidth = 0.7 + Math.random() * 1.1;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    x.stroke();
  }
  const d = x.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

// Even out exposure so dark and bright photos land in the same pencil range.
function normalize(gray, w, h) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = Math.round(h * 0.1); y < h * 0.9; y += 2) {
    for (let x = Math.round(w * 0.1); x < w * 0.9; x += 2) {
      hist[gray[y * w + x] | 0]++;
      n++;
    }
  }
  const pct = (p) => {
    let s = 0;
    for (let i = 0; i < 256; i++) {
      s += hist[i];
      if (s >= n * p) return i;
    }
    return 255;
  };
  const lo = pct(0.01);
  const hi = Math.max(lo + 40, pct(0.99));
  const med = clamp((pct(0.5) - lo) / (hi - lo), 0.08, 0.92);
  const gamma = clamp(Math.log(0.6) / Math.log(med), 0.45, 1.6);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 255 * Math.pow(clamp((gray[i] - lo) / (hi - lo), 0, 1), gamma);
  }
}

function hueSat(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return [0, 0, mx / 255];
  let hue;
  if (mx === r) hue = ((g - b) / (mx - mn)) % 6;
  else if (mx === g) hue = (b - r) / (mx - mn) + 2;
  else hue = (r - g) / (mx - mn) + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return [hue, (mx - mn) / mx, mx / 255];
}

// How red a source pixel is, 0..1. Accepts crimson and magenta-leaning reds,
// rejects orange and warm skin.
function redness(r, g, b) {
  const [hue, sat, val] = hueSat(r, g, b);
  const dist = hue > 180 ? 360 - hue : hue * 4;
  return (1 - smooth(14, 26, dist)) * smooth(0.62, 0.8, sat) * smooth(0.06, 0.18, val);
}

// How golden a source pixel is, 0..1: jewellery and zari, brighter and yellower than skin.
function goldness(r, g, b) {
  const [hue, sat, val] = hueSat(r, g, b);
  return smooth(30, 36, hue) * (1 - smooth(56, 66, hue)) * smooth(0.36, 0.54, sat) * smooth(0.42, 0.6, val);
}

// 0..1 inside any of the hand-marked ellipses [cx, cy, rx, ry] (fractions of the sketch).
function inSpots(spots, u, v) {
  let m = 0;
  for (const [cx, cy, rx, ry] of spots) {
    const d = Math.hypot((u - cx) / rx, (v - cy) / ry);
    m = Math.max(m, 1 - smooth(0.75, 1, d));
  }
  return m;
}

/**
 * @param {HTMLImageElement} img
 * @param {{width?: number, red?: boolean, gold?: boolean, spots?: number[][], wide?: boolean, crop?: number[]}} opts  crop is [x, y, w, h] as fractions of the photo
 * @returns {{lines: HTMLCanvasElement, full: HTMLCanvasElement, width: number, height: number}}
 *   `lines` is the light outline pass, `full` the finished shaded drawing.
 */
export function makeSketch(img, { width = 640, red = false, gold = false, spots = [], wide = false, crop = [0, 0, 1, 1] } = {}) {
  const cx = crop[0] * img.naturalWidth;
  const cy = crop[1] * img.naturalHeight;
  const cw = crop[2] * img.naturalWidth;
  const ch = crop[3] * img.naturalHeight;
  const W = width;
  const H = Math.round((W * ch) / cw);
  const src = newCanvas(W, H);
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.drawImage(img, cx, cy, cw, ch, 0, 0, W, H);
  const px = sx.getImageData(0, 0, W, H).data;
  const N = W * H;

  const gray = new Float32Array(N);
  for (let i = 0; i < N; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  normalize(gray, W, H);
  const soft = boxBlur(gray, W, H, 1, 1);
  const blur = boxBlur(gray, W, H, Math.max(3, Math.round(W / 70)), 3);
  const h1 = hatch(W, H, -Math.PI / 4, 26);
  const h2 = hatch(W, H, Math.PI / 3.4, 40);

  // `wide` keeps the drawing almost to the corners, for photos whose subject sits near an edge.
  const fadeFrom = wide ? 0.84 : 0.62;
  const lines = newCanvas(W, H);
  const full = newCanvas(W, H);
  const il = new ImageData(W, H);
  const ifu = new ImageData(W, H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // Colour-dodge of the photo against its own blur leaves only edges: the outlines.
      const line = Math.pow(clamp(soft[i] / (blur[i] + 1), 0, 1), 3.2);
      const shade = Math.pow(1 - gray[i] / 255, 1.35);
      // Fade toward the edge of the sheet so there is no photo rectangle.
      const ex = (x / W - 0.5) / 0.5;
      const ey = (y / H - 0.5) / 0.5;
      const fade = 1 - smooth(fadeFrom, 0.99, Math.cbrt(Math.abs(ex) ** 3 + Math.abs(ey) ** 3));
      const grain = (Math.random() - 0.5) * 0.07;

      let v = line * (1 - shade * (0.3 + 0.5 * h1[i]));
      v *= 1 - smooth(0.5, 1, shade) * 0.55 * h2[i];
      v = clamp(1 - (1 - v + grain * (1 - v + 0.15)) * fade, 0, 1);
      const vl = clamp(1 - (1 - line) * 0.75 * fade, 0, 1);

      let rd = 0;
      if (red) rd = redness(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      let strong = 0; // gold and marked spots are bright in the photo, so press the red pencil harder
      if (gold) strong = goldness(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      if (spots.length) {
        const lum = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
        // only the light thing inside the oval (a snow heart), not the dark things around it
        strong = Math.max(strong, inSpots(spots, x / W, y / H) * smooth(0.62, 0.8, lum));
      }
      rd = Math.max(rd, strong) * fade;
      const cover = clamp((0.5 + 0.5 * shade) * (0.62 + 0.38 * h1[i]) + (1 - line) * 0.4 + grain, 0, 1);
      const pencilRed = [214 - 96 * shade, 30 - 22 * shade, 54 - 30 * shade];

      for (let k = 0; k < 3; k++) {
        const graphite = DARK[k] + (PAPER[k] - DARK[k]) * v;
        const redMark = PAPER[k] + (pencilRed[k] - PAPER[k]) * Math.max(cover, 0.72 * strong);
        ifu.data[i * 4 + k] = graphite + (redMark - graphite) * rd;
        il.data[i * 4 + k] = DARK[k] + (PAPER[k] - DARK[k]) * vl;
      }
      ifu.data[i * 4 + 3] = il.data[i * 4 + 3] = 255;
    }
  }
  lines.getContext('2d').putImageData(il, 0, 0);
  full.getContext('2d').putImageData(ifu, 0, 0);
  return { lines, full, width: W, height: H };
}
