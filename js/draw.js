// Reveals a finished sketch on a canvas, either by an automatic pencil or by her finger.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Two stroke masks decide how much of the outline pass and the finished pass show.
function composer(canvas, sketch) {
  const { width: W, height: H } = sketch;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const outlineMask = newCanvas(W, H);
  const shadeMask = newCanvas(W, H);
  const tmp = newCanvas(W, H);
  const tx = tmp.getContext('2d');

  const layer = (mask, art, alpha) => {
    tx.globalCompositeOperation = 'source-over';
    tx.clearRect(0, 0, W, H);
    tx.drawImage(mask, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.drawImage(art, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(tmp, 0, 0);
    ctx.globalAlpha = 1;
  };

  return {
    W,
    H,
    outline: outlineMask.getContext('2d'),
    shade: shadeMask.getContext('2d'),
    shadeMask,
    paint(outlineAlpha = 1) {
      ctx.clearRect(0, 0, W, H);
      layer(outlineMask, sketch.lines, outlineAlpha);
      layer(shadeMask, sketch.full, 1);
    },
    fill(maskCtx) {
      maskCtx.fillStyle = '#000';
      maskCtx.fillRect(0, 0, W, H);
    },
  };
}

// Zigzag hatching route across the whole sheet, like shading by hand.
function route(W, H, step, antiDiagonal) {
  const pts = [];
  let flip = false;
  const j = () => (Math.random() - 0.5) * step * 0.7;
  const push = (a, b) => {
    if (flip) pts.push(b, a);
    else pts.push(a, b);
    flip = !flip;
  };
  if (antiDiagonal) {
    for (let d = 0; d <= W + H; d += step) {
      const x0 = Math.min(W, d);
      const x1 = Math.max(0, d - H);
      push([x0 + j(), d - x0 + j()], [x1 + j(), d - x1 + j()]);
    }
  } else {
    for (let c = -H; c <= W; c += step) {
      const x0 = Math.max(0, c);
      const x1 = Math.min(W, c + H);
      push([x0 + j(), x0 - c + j()], [x1 + j(), x1 - c + j()]);
    }
  }
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, len, total: len[len.length - 1] };
}

function pointAt(rt, d) {
  let i = 1;
  while (i < rt.len.length - 1 && rt.len[i] < d) i++;
  const span = rt.len[i] - rt.len[i - 1] || 1;
  const f = clamp((d - rt.len[i - 1]) / span, 0, 1);
  const a = rt.pts[i - 1];
  const b = rt.pts[i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, i];
}

function strokeAlong(ctx, rt, from, to, lineWidth) {
  const p0 = pointAt(rt, from);
  const p1 = pointAt(rt, to);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  for (let i = p0[2]; i < p1[2]; i++) ctx.lineTo(rt.pts[i][0], rt.pts[i][1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.stroke();
  return p1;
}

/** Show the finished drawing at once, no animation. */
export function showFinished(canvas, sketch) {
  const cp = composer(canvas, sketch);
  cp.fill(cp.shade);
  cp.paint();
}

/**
 * Pencil draws the sketch: light outlines first, then shading.
 * @returns {Promise<void>} resolves when the drawing is complete
 */
export function autoDraw(canvas, sketch, { pencil = null, outlineMs = 1500, shadeMs = 2900 } = {}) {
  const cp = composer(canvas, sketch);
  const { W, H } = cp;
  const r1 = route(W, H, W / 9, true);
  const r2 = route(W, H, W / 15, false);
  let d1 = 0;
  let d2 = 0;

  return new Promise((resolve) => {
    const t0 = performance.now();
    if (pencil) pencil.classList.add('on');
    const frame = (now) => {
      const t = now - t0;
      let tip = null;
      if (t < outlineMs) {
        const n = r1.total * (t / outlineMs);
        tip = strokeAlong(cp.outline, r1, d1, n, W / 6.5);
        d1 = n;
      } else if (t < outlineMs + shadeMs) {
        if (d1 < r1.total) {
          strokeAlong(cp.outline, r1, d1, r1.total, W / 6.5);
          d1 = r1.total;
        }
        const u = (t - outlineMs) / shadeMs;
        const n = r2.total * (u * u * (3 - 2 * u));
        tip = strokeAlong(cp.shade, r2, d2, n, W / 10);
        d2 = n;
      }
      cp.paint();
      if (tip && pencil) {
        pencil.style.left = `${clamp(tip[0] / W, 0, 1) * 100}%`;
        pencil.style.top = `${clamp(tip[1] / H, 0, 1) * 100}%`;
      }
      if (t < outlineMs + shadeMs) {
        requestAnimationFrame(frame);
        return;
      }
      cp.fill(cp.shade);
      cp.paint();
      if (pencil) pencil.classList.remove('on');
      resolve();
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Sketch stays hidden behind a faint outline until she rubs the paper.
 * @returns {Promise<void>} resolves once enough is drawn and the rest has filled in
 */
export function fingerDraw(canvas, sketch, { ghost = 0.22, enough = 0.5 } = {}) {
  const cp = composer(canvas, sketch);
  const { W, H } = cp;
  cp.fill(cp.outline);
  cp.paint(ghost);

  const probe = newCanvas(24, 36);
  const px = probe.getContext('2d', { willReadFrequently: true });
  const coverage = () => {
    px.clearRect(0, 0, 24, 36);
    px.drawImage(cp.shadeMask, 0, 0, 24, 36);
    const d = px.getImageData(0, 0, 24, 36).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 90) n++;
    return n / (24 * 36);
  };

  return new Promise((resolve) => {
    let last = null;
    let travelled = 0;
    let done = false;

    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };

    const finish = () => {
      done = true;
      const t0 = performance.now();
      cp.shade.fillStyle = 'rgba(0,0,0,.08)';
      const fillIn = (now) => {
        cp.shade.fillRect(0, 0, W, H);
        cp.paint(ghost);
        if (now - t0 < 1400) {
          requestAnimationFrame(fillIn);
          return;
        }
        cp.fill(cp.shade);
        cp.paint(ghost);
        resolve();
      };
      requestAnimationFrame(fillIn);
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (done) return;
      canvas.setPointerCapture(e.pointerId);
      last = at(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (done) return;
      // Mouse draws on hover; touch and pen only while pressed.
      if (e.pointerType !== 'mouse' && !last) return;
      const p = at(e);
      if (!last) {
        last = p;
        return;
      }
      const x = cp.shade;
      x.lineCap = x.lineJoin = 'round';
      x.strokeStyle = 'rgba(0,0,0,.8)';
      x.lineWidth = W / 8;
      x.beginPath();
      x.moveTo(last[0], last[1]);
      x.lineTo(p[0], p[1]);
      x.stroke();
      travelled += Math.hypot(p[0] - last[0], p[1] - last[1]);
      last = p;
      cp.paint(ghost);
      if (travelled > 600) {
        travelled = 0;
        if (coverage() > enough) finish();
      }
    });
    const lift = () => {
      last = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('pointerleave', lift);
  });
}
