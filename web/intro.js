// Стартовая заставка: силуэт Yori собирается из тысяч мелких точек.
// Кольцо толстых летящих линий разлетается из центра, схлопывается обратно, складывается в зернистый силуэт лица и плеч
// с надписью и снова разлетается лучами, открывая приложение. Положение каждой точки — функция от времени,
// поэтому любой кадр можно получить напрямую (адрес с ?introT=1.4 показывает кадр на 1,4 секунды).
// Телефон вибрирует в такт: удары на разлёте, нарастающая дробь при сборке, сильный удар, когда силуэт сложился,
// и затухающая россыпь после финального разлёта.

const T_EXPAND = 0.5; // кольцо раскрывается
const T_BURST = 2.45; // силуэт разлетается, под ним проявляется приложение
const T_END = 3.1;
const TAIL = 0.07; // длина следа: столько секунд движения тянется за точкой
const CELL = 2; // шаг сетки точек, px
const DOT = 1.6; // размер точки в покое, px
const WORD = "Yori";

// Три «глубины» лучей: ближние толще и темнее, дальние тоньше и бледнее; у ближних ещё и мягкое свечение.
const ALPHA = [1, 0.74, 0.48];
const DEPTH = [1.35, 0.95, 0.6];
const HALO = [0.12, 0, 0];

// Вибрация: [секунда заставки, сила]. Сила — стили Telegram: soft < light < medium < rigid < heavy.
const BEATS = [
  [0, "heavy"], [0.16, "medium"], [0.34, "light"], // кольцо разлетается и замедляется
  [0.64, "soft"], [0.88, "soft"], [1.06, "light"], [1.22, "light"], [1.36, "light"], // сборка: частота растёт
  [1.48, "medium"], [1.58, "medium"], [1.67, "medium"], [1.75, "rigid"], [1.82, "rigid"],
  [1.9, "heavy"], // силуэт сложился
  [2.2, "soft"], // пульс перед разлётом
  [T_BURST, "heavy"], [T_BURST + 0.13, "medium"], [T_BURST + 0.27, "light"], [T_BURST + 0.43, "soft"], [T_BURST + 0.59, "soft"], // затухание
];

// Контур человека (бюст) в долях кадра. Края за пределами кадра — чтобы плечи уходили за границы и растворялись.
const SILHOUETTE = [
  [0.38, 0.045], [0.5, 0.022], [0.62, 0.04], [0.72, 0.075], [0.79, 0.13], [0.82, 0.19], [0.845, 0.225], [0.82, 0.275], [0.775, 0.33], [0.72, 0.385],
  [0.78, 0.425], [0.88, 0.44], [0.96, 0.475], [1.01, 0.54], [1.04, 0.65], [1.06, 1.08], [-0.05, 1.08], [-0.03, 0.66], [0.03, 0.54],
  [0.11, 0.475], [0.22, 0.435], [0.3, 0.415], [0.35, 0.4], [0.33, 0.36], [0.3, 0.32], [0.285, 0.29], [0.265, 0.245], [0.255, 0.215], [0.275, 0.18], [0.295, 0.12], [0.33, 0.075],
];
// Участок рубашки, где на фото напечатано прежнее слово: его тон заменяем ровным тоном рубашки.
const PRINT = { x0: 0.15, x1: 0.88, y0: 0.6, y1: 0.84 };
const SHIRT_LEVEL = 0.93;

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

function makeCanvas(side) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  return canvas;
}

// Размытая копия картинки: уменьшаем в несколько шагов и растягиваем обратно. Чем больше divisor, тем слабее размытие.
function blurred(source, grid, divisor) {
  let canvas = source;
  let side = grid;
  while (side > Math.max(6, grid / divisor)) {
    side = Math.max(6, Math.round(side / 2.2));
    const next = makeCanvas(side);
    const g = next.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(canvas, 0, 0, side, side);
    canvas = next;
  }
  const out = makeCanvas(grid);
  const g = out.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(canvas, 0, 0, grid, grid);
  return g.getImageData(0, 0, grid, grid).data;
}

// Силуэт: контур со сглаженными углами, края мягкие.
function silhouetteCanvas(grid) {
  const canvas = makeCanvas(grid);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.scale(grid, grid);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = SILHOUETTE.length;
  g.beginPath();
  const start = mid(SILHOUETTE[n - 1], SILHOUETTE[0]);
  g.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const control = SILHOUETTE[i];
    const end = mid(control, SILHOUETTE[(i + 1) % n]);
    g.quadraticCurveTo(control[0], control[1], end[0], end[1]);
  }
  g.closePath();
  g.fillStyle = "#000";
  g.fill();
  return canvas;
}

// Надпись плотным жирным шрифтом: маска «есть буква / нет буквы» в сетке точек.
async function wordmark(grid) {
  try {
    await Promise.race([document.fonts.load(`900 64px "Unbounded"`, WORD), new Promise((_, reject) => setTimeout(reject, 900))]);
  } catch {
    // шрифт не успел: возьмём системный жирный
  }
  const canvas = makeCanvas(grid);
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const family = `"Unbounded", "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  g.font = `900 ${grid * 0.2}px ${family}`;
  const scale = (grid * 0.5) / g.measureText(WORD).width;
  g.font = `900 ${grid * 0.2 * scale}px ${family}`;
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const box = g.measureText(WORD);
  g.fillStyle = "#000";
  g.fillText(WORD, grid * 0.52, grid * 0.715 + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2);
  return g.getImageData(0, 0, grid, grid).data;
}

// Из фото получается набор точек: форма — силуэт, тон — по фото (лицо, волосы, складки рубашки), надпись — сплошная.
async function sampleLogo(img, size, onDark) {
  const grid = Math.round(size / CELL);
  const probe = makeCanvas(grid);
  const g = probe.getContext("2d", { willReadFrequently: true });
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const inset = side * 0.05; // скруглённые углы исходной картинки в кадр не попадают
  g.imageSmoothingQuality = "high";
  g.drawImage(img, (img.naturalWidth - side) / 2 + inset, (img.naturalHeight - side) / 2 + inset, side - inset * 2, side - inset * 2, 0, 0, grid, grid);
  const { data } = g.getImageData(0, 0, grid, grid);
  // Размытая копия нужна для локального контраста: лицо почти сливается со стеной, а так его контур проявляется.
  const local = blurred(probe, grid, 10);
  const shape = silhouetteCanvas(grid);
  const maskData = shape.getContext("2d").getImageData(0, 0, grid, grid).data;
  const softMask = blurred(shape, grid, 6); // для контурной линии по краю силуэта
  const word = await wordmark(grid);
  const points = [];
  const cell = size / grid;
  for (let y = 0; y < grid; y++) {
    const v = (y + 0.5) / grid;
    for (let x = 0; x < grid; x++) {
      const k = (y * grid + x) * 4;
      const inside = maskData[k + 3] / 255;
      if (inside < 0.02) continue;
      const u = (x + 0.5) / grid;
      let ink;
      let kind = 0;
      if (word[k + 3] > 110) {
        ink = 1;
        kind = 2;
      } else {
        const lum = (0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]) / 255;
        const mean = (0.299 * local[k] + 0.587 * local[k + 1] + 0.114 * local[k + 2]) / 255;
        // Кожа тёплая (красного больше, чем синего), стена и рубашка серые: добавка «тепла» отделяет лицо от волос и рубашки.
        const warmth = (data[k] - data[k + 2]) / 255;
        let level = clamp01((lum + 1.4 * (lum - mean) - 0.6 * warmth - 0.05) / (0.8 - 0.05));
        if (u > PRINT.x0 && u < PRINT.x1 && v > PRINT.y0 && v < PRINT.y1) level = SHIRT_LEVEL;
        // Светлая тема: тёмные места плотнее; тёмная: светлые. Рубашка остаётся тихим фоном, чтобы надпись была ярче всего.
        ink = onDark ? 0.08 + 0.5 * smoothstep(0, 1, level) : 0.27 + 0.73 * smoothstep(0.25, 1, 1 - level);
        // Плотная линия по краю силуэта: контур читается и на светлой, и на тёмной теме.
        const rim = smoothstep(0.93, 0.62, softMask[k + 3] / 255);
        if (rim * 0.85 > ink) {
          ink = rim * 0.85;
          kind = 1;
        }
        // Плечи уходят за границы кадра и растворяются, низ тоже.
        ink *= inside * smoothstep(0, 0.15, Math.min(u, 1 - u)) * (1 - smoothstep(0.86, 1, v));
      }
      if (ink > BAYER[(y & 7) * 8 + (x & 7)]) points.push([(x + 0.5) * cell - size / 2, (y + 0.5) * cell - size / 2, kind]);
    }
  }
  return points;
}

function buildParticles(points, size, reach, rand) {
  const ghosts = Math.round(points.length * 0.12); // лишние «летящие» точки: только для плотности лучей, в силуэт не входят
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
    kind: new Uint8Array(total), // 0 обычная, 1 линия по краю силуэта, 2 буква надписи
    solid: new Uint8Array(total), // буквы надписи: ближайшая глубина и точки крупнее, чтобы слились в сплошной шрифт
  };
  for (let i = 0; i < total; i++) {
    const target = points[i < points.length ? i : Math.floor(rand() * points.length)];
    [p.tx[i], p.ty[i]] = target;
    p.kind[i] = i < points.length ? target[2] : 0;
    p.solid[i] = p.kind[i] === 2 ? 1 : 0;
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
    p.tier[i] = p.solid[i] || target[2] === 1 ? 0 : rand() < 0.4 ? 0 : rand() < 0.6 ? 1 : 2;
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

// Буферы кадра заводятся один раз: в каждом кадре тысячи фигур, лишний мусор для сборщика ни к чему.
function makeBuffers(total) {
  return {
    dots: [0, 1, 2].map(() => new Float32Array(total * 3)), // x, y, размер
    streaks: [0, 1, 2].map(() => new Float32Array(total * 5)), // хвост x, y, голова x, y, ширина
    counts: { dots: [0, 0, 0], streaks: [0, 0, 0] },
  };
}

// Луч — трапеция: у головы шире, к хвосту сужается. Ширина растёт с удалением от центра, как при полёте на зрителя.
function streakPath(ctx, list, count, grow) {
  ctx.beginPath();
  for (let k = 0; k < count; k += 5) {
    const bx = list[k];
    const by = list[k + 1];
    const ax = list[k + 2];
    const ay = list[k + 3];
    const half = (list[k + 4] * grow) / 2;
    const dx = ax - bx;
    const dy = ay - by;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    ctx.moveTo(bx + nx * 0.2, by + ny * 0.2);
    ctx.lineTo(ax + nx, ay + ny);
    ctx.lineTo(ax - nx, ay - ny);
    ctx.lineTo(bx - nx * 0.2, by - ny * 0.2);
    ctx.closePath();
  }
}

// Общее для обоих способов рисования: прозрачность кадра и полоса света.
function frameParams(t, size) {
  return {
    // Кольцо не вспыхивает разом, а проступает за первые доли секунды; в конце всё растворяется.
    fade: (0.3 + 0.7 * smoothstep(0, 0.22, t)) * (1 - smoothstep(T_BURST + 0.12, T_BURST + 0.62, t)),
    // Полоса света медленно проходит по готовому силуэту сверху вниз: точки в ней крупнеют.
    scan: smoothstep(1.85, 1.95, t) * (1 - smoothstep(T_BURST - 0.05, T_BURST, t)),
    scanY: -size / 2 + ((t - 1.9) / (T_BURST - 1.9)) * size * 1.2,
  };
}

// Запасной способ рисования (если у телефона нет WebGL): плоский холст, лучи — трапеции с мягким свечением.
function render(ctx, p, buffers, view, t, color) {
  const { width, height, cx, cy, spread, size } = view;
  ctx.clearRect(0, 0, width, height);
  const { fade, scan, scanY } = frameParams(t, size);
  if (fade <= 0) return;
  const a = { x: 0, y: 0 };
  const b = { x: 0, y: 0 };
  const { dots, streaks, counts } = buffers;
  counts.dots.fill(0);
  counts.streaks.fill(0);
  for (let i = 0; i < p.total; i++) {
    // «Лишние» точки гаснут, когда долетают до силуэта.
    if (i >= p.total - p.ghosts && t > p.tg[i] + 0.05) continue;
    place(p, i, t, a);
    place(p, i, Math.max(0, t - TAIL), b);
    const tier = p.tier[i];
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy < 1.6) {
      const n = counts.dots[tier];
      const near = scan * Math.exp(-(((a.y - scanY) / (size * 0.05)) ** 2));
      dots[tier][n] = cx + a.x;
      dots[tier][n + 1] = cy + a.y;
      dots[tier][n + 2] = DOT * (p.solid[i] ? 1.3 : 1) * (1 + 0.7 * near);
      counts.dots[tier] = n + 3;
    } else {
      const n = counts.streaks[tier];
      const list = streaks[tier];
      list[n] = cx + b.x;
      list[n + 1] = cy + b.y;
      list[n + 2] = cx + a.x;
      list[n + 3] = cy + a.y;
      list[n + 4] = DEPTH[tier] * (0.7 + 1.7 * Math.min(1, Math.hypot(a.x, a.y) / spread));
      counts.streaks[tier] = n + 5;
    }
  }
  ctx.fillStyle = color;
  for (let tier = 0; tier < 3; tier++) {
    if (HALO[tier]) {
      ctx.globalAlpha = HALO[tier] * fade;
      streakPath(ctx, streaks[tier], counts.streaks[tier], 2.8);
      ctx.fill();
    }
    ctx.globalAlpha = ALPHA[tier] * fade;
    streakPath(ctx, streaks[tier], counts.streaks[tier], 1);
    ctx.fill();
    const list = dots[tier];
    if (counts.dots[tier]) {
      ctx.beginPath();
      for (let k = 0; k < counts.dots[tier]; k += 3) ctx.rect(list[k] - list[k + 2] / 2, list[k + 1] - list[k + 2] / 2, list[k + 2], list[k + 2]);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- Основной способ рисования: WebGL ----------
// Положение каждой точки считает видеокарта по тем же формулам, что и place(): процессор в кадре только сообщает время.
// Луч — вытянутый четырёхугольник с мягкими краями и бледнеющим хвостом: ближние лучи толще, дальние тоньше и прозрачнее.

const f = (n) => Number(n).toFixed(4);

const VERTEX = `
precision highp float;
attribute vec2 a_target;
attribute vec2 a_dir;
attribute vec2 a_reach;
attribute vec2 a_time;
attribute vec2 a_burst;
attribute vec4 a_misc;
attribute vec2 a_corner;
uniform float u_t;
uniform vec2 u_view;
uniform vec2 u_center;
uniform float u_fade;
uniform float u_scan;
uniform float u_scanY;
uniform float u_size;
uniform float u_spread;
varying float v_across;
varying float v_along;
varying float v_streak;
varying float v_alpha;

vec2 place(float t) {
  float te = a_time.x;
  float tg = a_time.y;
  if (t < te) {
    float k = 1.0 - t / te;
    return a_dir * mix(a_reach.x, a_reach.y, 1.0 - k * k * k);
  }
  if (t < tg) {
    float u = (t - te) / (tg - te);
    float k = -2.0 * u + 2.0;
    float e = u < 0.5 ? 4.0 * u * u * u : 1.0 - k * k * k / 2.0;
    return mix(a_dir * a_reach.y, a_target, e);
  }
  float bd = a_misc.x;
  if (t < ${f(T_BURST)} + bd) return a_target;
  float u = clamp((t - ${f(T_BURST)} - bd) / 0.62, 0.0, 1.0);
  return a_target + a_burst * (u * u * u);
}

void main() {
  float tier = a_misc.y;
  float kind = a_misc.z;
  float alpha = tier < 0.5 ? ${f(ALPHA[0])} : (tier < 1.5 ? ${f(ALPHA[1])} : ${f(ALPHA[2])});
  float depth = tier < 0.5 ? ${f(DEPTH[0])} : (tier < 1.5 ? ${f(DEPTH[1])} : ${f(DEPTH[2])});
  // «Лишние» точки гаснут, когда долетают до силуэта.
  bool gone = a_misc.w > 0.5 && u_t > a_time.y + 0.05;
  if (gone || u_fade <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 head = place(u_t);
  vec2 tail = place(max(0.0, u_t - ${f(TAIL)}));
  vec2 d = head - tail;
  float len = length(d);
  vec2 pos;
  if (len * len < 1.6) {
    float q = (head.y - u_scanY) / (u_size * 0.05);
    float near = u_scan * exp(-q * q);
    float s = ${f(DOT)} * (kind > 1.5 ? 1.3 : 1.0) * (1.0 + 0.7 * near);
    pos = head + vec2((a_corner.x - 0.5) * s, a_corner.y * 0.5 * s);
    v_streak = 0.0;
  } else {
    vec2 dir = d / len;
    vec2 nrm = vec2(-dir.y, dir.x);
    float width = depth * (1.0 + 2.3 * min(1.0, length(head) / u_spread));
    float spreadOut = 0.5 * width * mix(0.15, 1.0, a_corner.x);
    pos = mix(tail, head, a_corner.x) + nrm * (a_corner.y * spreadOut);
    v_streak = 1.0;
  }
  v_alpha = alpha * u_fade;
  v_across = a_corner.y;
  v_along = a_corner.x;
  vec2 px = u_center + pos;
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 u_color;
varying float v_across;
varying float v_along;
varying float v_streak;
varying float v_alpha;

void main() {
  float a = v_alpha;
  if (v_streak > 0.5) {
    float edge = 1.0 - smoothstep(0.3, 1.0, abs(v_across));
    a *= edge * mix(0.2, 1.0, v_along);
  }
  gl_FragColor = vec4(u_color * a, a);
}`;

function parseColor(value) {
  const hex = value.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) : [0.04, 0.04, 0.05];
}

// Возвращает { draw(t), lost } или null, если WebGL недоступен (тогда холст нужно заменить на свежий и рисовать плоско).
function glRenderer(canvas, p, view, color, keepBuffer) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: keepBuffer, powerPreference: "high-performance" });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  ["a_target", "a_dir", "a_reach", "a_time", "a_burst", "a_misc", "a_corner"].forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // Каждая точка — два треугольника (шесть вершин); все свойства точки лежат в вершинах, время приходит одним числом.
  const corners = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
  const floats = 16;
  const data = new Float32Array(p.total * corners.length * floats);
  let o = 0;
  for (let i = 0; i < p.total; i++) {
    const ghost = i >= p.total - p.ghosts ? 1 : 0;
    for (const [cx, cy] of corners) {
      data.set([p.tx[i], p.ty[i], p.ca[i], p.sa[i], p.r0[i], p.reach[i], p.te[i], p.tg[i], p.bx[i], p.by[i], p.bd[i], p.tier[i], p.kind[i], ghost, cx, cy], o);
      o += floats;
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  let offset = 0;
  [2, 2, 2, 2, 2, 4, 2].forEach((size, i) => {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, floats * 4, offset * 4);
    offset += size;
  });

  const uniform = (name) => gl.getUniformLocation(program, name);
  const at = { t: uniform("u_t"), fade: uniform("u_fade"), scan: uniform("u_scan"), scanY: uniform("u_scanY") };
  gl.uniform2f(uniform("u_view"), view.width, view.height);
  gl.uniform2f(uniform("u_center"), view.cx, view.cy);
  gl.uniform1f(uniform("u_size"), view.size);
  gl.uniform1f(uniform("u_spread"), view.spread);
  gl.uniform3fv(uniform("u_color"), parseColor(color));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  return {
    // На слабой видеокарте холст можно сделать менее чётким: расстояния и время те же, нагрузка падает.
    resize(scale) {
      canvas.width = Math.round(view.width * view.dpr * scale);
      canvas.height = Math.round(view.height * view.dpr * scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw(t) {
      const { fade, scan, scanY } = frameParams(t, view.size);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (fade <= 0) return;
      gl.uniform1f(at.t, t);
      gl.uniform1f(at.fade, fade);
      gl.uniform1f(at.scan, scan);
      gl.uniform1f(at.scanY, scanY);
      gl.drawArrays(gl.TRIANGLES, 0, p.total * corners.length);
    },
  };
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
// onReveal вызывается в момент, когда силуэт разлетается и под ним должно проявиться приложение.
// onPulse(сила) вызывается в такт анимации — туда подключается вибрация телефона.
export async function playIntro({ onReveal = () => {}, onPulse = () => {} } = {}) {
  const root = document.getElementById("intro");
  let canvas = root?.querySelector("canvas");
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
  const fit = () => {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  };
  fit();

  const size = Math.round(Math.min(width * 0.9, height * 0.52, 400));
  const reach = Math.hypot(width, height) * 0.62;
  const rand = mulberry32(20251025);
  let particles;
  try {
    particles = buildParticles(await sampleLogo(img, size, onDark), size, reach, rand);
  } catch {
    return finish();
  }
  const view = { width, height, dpr, cx: width / 2, cy: height / 2 - height * 0.02, spread: reach * 0.9, size };

  // WebGL, а если его нет (или шейдеры не собрались) — плоский холст на свежем элементе.
  const gl = new URLSearchParams(location.search).has("intro2d") ? null : glRenderer(canvas, particles, view, color, Boolean(frozen));
  let draw;
  let resize;
  if (gl) {
    draw = gl.draw;
    resize = gl.resize;
  } else {
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    canvas = fresh;
    fit();
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const buffers = makeBuffers(particles.total);
    draw = (t) => render(ctx, particles, buffers, view, t, color);
    resize = (scale) => {
      canvas.width = Math.round(width * dpr * scale);
      canvas.height = Math.round(height * dpr * scale);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    };
  }

  if (frozen) {
    draw(frozen);
    return;
  }

  return new Promise((resolve) => {
    let start = null; // отсчёт — с первого показанного кадра: затянувшийся запуск не съедает начало анимации и первый удар
    let revealed = false;
    let beat = 0;
    let previous = 0;
    let slow = 0;
    let lowRes = false;
    const done = () => {
      root.remove();
      if (!revealed) {
        revealed = true;
        onReveal();
      }
      resolve();
    };
    // Если система отобрала у страницы видеокарту, заставку просто заканчиваем, приложение уже готово.
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      done();
    });
    const tick = (now) => {
      if (start === null) start = now;
      const t = (now - start) / 1000;
      // Удары вибрации привязаны к времени заставки; если кадр запоздал (вкладка была скрыта) или заставку пропустили, старые удары не повторяем.
      while (beat < BEATS.length && BEATS[beat][0] <= t) {
        if (t - BEATS[beat][0] < 0.18) onPulse(BEATS[beat][1]);
        beat++;
      }
      if (t >= T_BURST && !revealed) {
        revealed = true;
        root.classList.add("is-revealing");
        onReveal();
      }
      if (t >= T_END) return done();
      // Если кадры идут медленнее 22 к/с, холст упрощается: анимация и вибрация не замедляются, просто картинка чуть мягче.
      if (!lowRes && t > 0.3 && t < 2) {
        if (now - previous > 45) slow++;
        if (slow >= 6) {
          lowRes = true;
          resize(0.6);
        }
      }
      previous = now;
      draw(t);
      requestAnimationFrame(tick);
    };
    // Нажатие пропускает ожидание: сразу к финальному разлёту.
    root.addEventListener("pointerdown", () => {
      if (start === null) return;
      const t = (performance.now() - start) / 1000;
      if (t < T_BURST) start = performance.now() - T_BURST * 1000;
    });
    requestAnimationFrame(tick);
  });
}
