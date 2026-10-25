// Стартовая заставка: логотип Yorisell собирается из тысяч мелких точек.
// Кольцо тонких линий разлетается из центра, схлопывается обратно, складывается в зернистый портрет
// и снова разлетается лучами, открывая приложение. Положение каждой точки — функция от времени,
// поэтому любой кадр можно получить напрямую (адрес с ?introT=1.4 показывает кадр на 1,4 секунды).

const T_EXPAND = 0.5; // кольцо раскрывается
const T_BURST = 2.45; // портрет разлетается, под ним проявляется приложение
const T_END = 3.1;
const TAIL = 0.055; // длина следа: столько секунд движения тянется за точкой
const CELL = 2; // шаг сетки точек, px
const DOT = 1.6; // размер точки в покое, px
const TIERS = [1, 0.7, 0.45]; // три степени яркости точек

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (u) => 1 - (1 - u) ** 3;
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const easeInCubic = (u) => u * u * u;
const smoothstep = (a, b, v) => {
  const u = clamp01((v - a) / (b - a));
  return u * u * (3 - 2 * u);
};

// Матрица Байера 8×8: порог для упорядоченного растра (даёт тот самый «зернистый» вид).
const BAYER = (() => {
  let m = [[0, 2], [3, 1]];
  for (let n = 2; n < 8; n *= 2) {
    const next = Array.from({ length: n * 2 }, () => new Array(n * 2));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    }
    m = next;
  }
  return m.flat().map((v) => (v + 0.5) / 64);
})();

// Логотип превращается в набор точек: тёмные места на светлой теме и светлые на тёмной получают больше точек.
function sampleLogo(img, size, onDark) {
  const grid = Math.round(size / CELL);
  const probe = document.createElement("canvas");
  probe.width = probe.height = grid;
  const g = probe.getContext("2d", { willReadFrequently: true });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const inset = side * 0.05; // скруглённые углы исходной картинки в кадр не попадают
  g.imageSmoothingQuality = "high";
  g.drawImage(img, (img.naturalWidth - side) / 2 + inset, (img.naturalHeight - side) / 2 + inset, side - inset * 2, side - inset * 2, 0, 0, grid, grid);
  const { data } = g.getImageData(0, 0, grid, grid);
  // Размытая копия нужна для локального контраста: лицо почти сливается со стеной, а так его контур проявляется.
  const local = blurred(probe, grid);
  const points = [];
  const cell = size / grid;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const k = (y * grid + x) * 4;
      const lum = (0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]) / 255;
      const mean = (0.299 * local[k] + 0.587 * local[k + 1] + 0.114 * local[k + 2]) / 255;
      // Кожа тёплая (красного больше, чем синего), стена и рубашка серые: добавка «тепла» отделяет лицо от стены.
      const warmth = (data[k] - data[k + 2]) / 255;
      const level = clamp01((lum + 1.4 * (lum - mean) - 0.6 * warmth - 0.05) / (0.8 - 0.05));
      const dx = ((x + 0.5) / grid) * 2 - 1;
      const dy = ((y + 0.5) / grid) * 2 - 1;
      const fade = smoothstep(1.08, 0.78, Math.hypot(dx, dy)); // по краям портрет растворяется
      const tone = onDark ? level : 1 - level;
      // На светлой теме лёгкое зерно по всему кругу намекает на плечи и общий силуэт.
      const ink = Math.min(1, smoothstep(0.1, 1, tone) + (onDark ? 0 : 0.07)) * fade;
      if (ink > BAYER[(y & 7) * 8 + (x & 7)]) points.push([(x + 0.5) * cell - size / 2, (y + 0.5) * cell - size / 2]);
    }
  }
  return points;
}

// Сильно размытая копия картинки: уменьшаем в несколько шагов и растягиваем обратно.
function blurred(source, grid) {
  let canvas = source;
  let side = grid;
  while (side > Math.max(6, grid / 10)) {
    side = Math.max(6, Math.round(side / 2.2));
    const next = document.createElement("canvas");
    next.width = next.height = side;
    const g = next.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(canvas, 0, 0, side, side);
    canvas = next;
  }
  const out = document.createElement("canvas");
  out.width = out.height = grid;
  const g = out.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(canvas, 0, 0, grid, grid);
  return g.getImageData(0, 0, grid, grid).data;
}

function buildParticles(points, size, reach, rand) {
  const ghosts = Math.round(points.length * 0.12); // лишние «летящие» точки: только для плотности лучей, в логотип не входят
  const total = points.length + ghosts;
  const p = {
    total,
    ghosts,
    tx: new Float32Array(total),
    ty: new Float32Array(total),
    ca: new Float32Array(total),
    sa: new Float32Array(total),
    r0: new Float32Array(total),
    reach: new Float32Array(total),
    te: new Float32Array(total),
    tg: new Float32Array(total),
    bx: new Float32Array(total),
    by: new Float32Array(total),
    bd: new Float32Array(total),
    tier: new Uint8Array(total),
  };
  for (let i = 0; i < total; i++) {
    if (i < points.length) {
      [p.tx[i], p.ty[i]] = points[i];
    } else {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * size * 0.5;
      p.tx[i] = Math.cos(a) * r;
      p.ty[i] = Math.sin(a) * r;
    }
    const angle = rand() * Math.PI * 2;
    p.ca[i] = Math.cos(angle);
    p.sa[i] = Math.sin(angle);
    p.r0[i] = size * (0.1 + 0.22 * rand());
    p.reach[i] = rand() < 0.1 ? size * 0.9 + rand() * reach : size * (0.5 + 0.85 * rand() ** 1.4);
    p.te[i] = T_EXPAND * (0.45 + 0.55 * rand());
    p.tg[i] = p.te[i] + 0.85 + 0.5 * rand();
    const len = Math.hypot(p.tx[i], p.ty[i]) || 1;
    const spread = (rand() - 0.5) * 0.5;
    const ux = p.tx[i] / len;
    const uy = p.ty[i] / len;
    const dist = reach * (0.45 + 0.9 * rand());
    p.bx[i] = (ux * Math.cos(spread) - uy * Math.sin(spread)) * dist;
    p.by[i] = (ux * Math.sin(spread) + uy * Math.cos(spread)) * dist;
    p.bd[i] = rand() * 0.22 + (len / size) * 0.2;
    p.tier[i] = rand() < 0.5 ? 0 : rand() < 0.6 ? 1 : 2;
  }
  return p;
}

// Где точка i в момент t. Возвращает смещение от центра логотипа.
function place(p, i, t, out) {
  if (t < p.te[i]) {
    const e = easeOutCubic(t / p.te[i]);
    const r = p.r0[i] + (p.reach[i] - p.r0[i]) * e;
    out.x = p.ca[i] * r;
    out.y = p.sa[i] * r;
  } else if (t < p.tg[i]) {
    const e = easeInOutCubic((t - p.te[i]) / (p.tg[i] - p.te[i]));
    const sx = p.ca[i] * p.reach[i];
    const sy = p.sa[i] * p.reach[i];
    out.x = sx + (p.tx[i] - sx) * e;
    out.y = sy + (p.ty[i] - sy) * e;
  } else if (t < T_BURST + p.bd[i]) {
    out.x = p.tx[i];
    out.y = p.ty[i];
  } else {
    const e = easeInCubic(clamp01((t - T_BURST - p.bd[i]) / 0.62));
    out.x = p.tx[i] + p.bx[i] * e;
    out.y = p.ty[i] + p.by[i] * e;
  }
}

function render(ctx, p, view, t, color) {
  const { width, height, cx, cy } = view;
  ctx.clearRect(0, 0, width, height);
  const fade = 1 - smoothstep(T_BURST + 0.12, T_BURST + 0.62, t);
  if (fade <= 0) return;
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  const dots = [[], [], []];
  const lines = [[], [], []];
  for (let i = 0; i < p.total; i++) {
    const ghost = i >= p.total - p.ghosts;
    // «Лишние» точки гаснут, когда долетают до портрета.
    if (ghost && t > p.tg[i] + 0.05) continue;
    place(p, i, t, a);
    place(p, i, Math.max(0, t - TAIL), b);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy < 1.4) dots[p.tier[i]].push(cx + a.x, cy + a.y);
    else lines[p.tier[i]].push(cx + b.x, cy + b.y, cx + a.x, cy + a.y);
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let tier = 0; tier < 3; tier++) {
    ctx.globalAlpha = TIERS[tier] * fade;
    const d = dots[tier];
    if (d.length) {
      ctx.beginPath();
      for (let k = 0; k < d.length; k += 2) ctx.rect(d[k] - DOT / 2, d[k + 1] - DOT / 2, DOT, DOT);
      ctx.fill();
    }
    const l = lines[tier];
    if (l.length) {
      ctx.beginPath();
      for (let k = 0; k < l.length; k += 4) {
        ctx.moveTo(l[k], l[k + 1]);
        ctx.lineTo(l[k + 2], l[k + 3]);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Показывает заставку и возвращает промис, который завершается, когда она убрана.
// onReveal вызывается в момент, когда портрет разлетается и под ним должно проявиться приложение.
export async function playIntro({ onReveal = () => {} } = {}) {
  const root = document.getElementById("intro");
  const canvas = root?.querySelector("canvas");
  const finish = () => {
    root?.remove();
    onReveal();
  };
  const frozen = Number(new URLSearchParams(location.search).get("introT"));
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!root || !canvas || !canvas.getContext || (reduce && !frozen)) return finish();

  let img;
  try {
    img = await Promise.race([loadImage(root.dataset.logo), new Promise((_, reject) => setTimeout(reject, 1500))]);
  } catch {
    return finish();
  }

  const color = getComputedStyle(document.documentElement).getPropertyValue("--intro-ink").trim() || "#0b0b0c";
  const onDark = document.documentElement.dataset.theme === "dark";
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const size = Math.round(Math.min(width * 0.78, height * 0.46, 340));
  const reach = Math.hypot(width, height) * 0.62;
  const rand = mulberry32(20251025);
  const particles = buildParticles(sampleLogo(img, size, onDark), size, reach, rand);
  const view = { width, height, cx: width / 2, cy: height / 2 - height * 0.02 };

  if (frozen) {
    render(ctx, particles, view, frozen, color);
    return;
  }

  return new Promise((resolve) => {
    let start = performance.now();
    let revealed = false;
    const done = () => {
      root.remove();
      resolve();
    };
    const tick = (now) => {
      const t = (now - start) / 1000;
      if (t >= T_BURST && !revealed) {
        revealed = true;
        root.classList.add("is-revealing");
        onReveal();
      }
      if (t >= T_END) return done();
      render(ctx, particles, view, t, color);
      requestAnimationFrame(tick);
    };
    // Нажатие пропускает ожидание: сразу к финальному разлёту.
    root.addEventListener("pointerdown", () => {
      const t = (performance.now() - start) / 1000;
      if (t < T_BURST) start = performance.now() - T_BURST * 1000;
    });
    requestAnimationFrame(tick);
  });
}
