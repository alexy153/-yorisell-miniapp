// Стартовая заставка: слово «Yori» собирается из осколков.
// Осколки разлетаются кольцом из центра, кувыркаются, возвращаются и складываются в слово — между ними остаются
// тонкие трещины, по которым слово видно как мозаику, а не как сплошную надпись. Потом оно снова разлетается.
// Форма осколков — ячейки Вороного, нарезанные прямо по буквам, поэтому в собранном виде они стыкуются точно.
// Положение каждого осколка — функция от времени, поэтому любой кадр можно получить напрямую (адрес с ?introT=1.4).
// Телефон вибрирует в такт: удары на разлёте, нарастающая дробь при сборке, сильный удар, когда слово сложилось,
// пульс перед финалом и затухающая россыпь после финального разлёта.

const T_EXPAND = 0.5; // осколки разлетаются кольцом
const T_BURST = 2.75; // слово разлетается, под ним проявляется приложение
const T_END = 3.4;
const WORD = "Yori";
const SHARD = 8.6; // средний размер осколка у слова шириной WORD_REF, px
const CRACK = 1.3; // ширина трещины между осколками у слова шириной WORD_REF, px
const WORD_REF = 335;
const GHOSTS = 1.9; // летающих осколков-«декораций» на каждый настоящий осколок слова

// Вибрация: [секунда заставки, сила]. Сила — стили Telegram: soft < light < medium < rigid < heavy.
const BEATS = [
  [0, "heavy"], [0.16, "medium"], [0.34, "light"], // осколки разлетаются и замедляются
  [0.64, "soft"], [0.88, "soft"], [1.06, "light"], [1.22, "light"], [1.36, "light"], // сборка: частота растёт
  [1.48, "medium"], [1.58, "medium"], [1.67, "medium"], [1.75, "rigid"], [1.82, "rigid"],
  [1.9, "heavy"], // слово сложилось
  [2.3, "soft"], [2.55, "soft"], // слово держится, по нему пробегает блик
  [T_BURST, "heavy"], [T_BURST + 0.13, "medium"], [T_BURST + 0.27, "light"], [T_BURST + 0.43, "soft"], [T_BURST + 0.59, "soft"], // затухание
];

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
const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const smoothstep = (a, b, v) => {
  const u = clamp01((v - a) / (b - a));
  return u * u * (3 - 2 * u);
};

function rectCanvas(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// ---------- Слово, нарезанное на осколки ----------

// Зёрна осколков: случайные точки внутри букв не ближе друг к другу, чем нужно. У каждого зерна свой радиус,
// поэтому осколки получаются разного размера; потом добавляются зёрна в уголки, куда случайные не попали.
function scatterSeeds(inside, W, H, S, rand, shard) {
  const seeds = [];
  const wCss = W / S;
  const hCss = H / S;
  const isInside = (x, y) => {
    const tx = Math.floor(x * S);
    const ty = Math.floor(y * S);
    return tx >= 0 && ty >= 0 && tx < W && ty < H && inside[ty * W + tx] === 1;
  };
  for (let attempt = 0; attempt < 16000; attempt++) {
    const x = rand() * wCss;
    const y = rand() * hCss;
    if (!isInside(x, y)) continue;
    const r = shard * (0.72 + 0.62 * rand());
    let free = true;
    for (const s of seeds) {
      const m = (s[2] + r) * 0.5;
      if ((s[0] - x) ** 2 + (s[1] - y) ** 2 < m * m) {
        free = false;
        break;
      }
    }
    if (free) seeds.push([x, y, r]);
  }
  for (let y = 1; y < hCss; y += 2.5) {
    for (let x = 1; x < wCss; x += 2.5) {
      if (!isInside(x, y)) continue;
      let near = Infinity;
      for (const s of seeds) near = Math.min(near, Math.hypot(s[0] - x, s[1] - y));
      if (near > shard * 0.95) seeds.push([x, y, shard * 0.8]);
    }
  }
  return seeds;
}

// Рисует слово и режет его: каждому пикселю буквы достаётся ближайшее зерно, у границ между зёрнами остаются трещины.
// Результат — карта осколков (R, G — номер осколка, A — «пиксель есть») и список осколков с размерами.
async function buildWord(targetW, S, rand) {
  try {
    await Promise.race([document.fonts.load(`900 64px "Unbounded"`, WORD), new Promise((_, reject) => setTimeout(reject, 900))]);
  } catch {
    // шрифт не успел: возьмём системный жирный
  }
  // Осколки и трещины меняются вместе со словом, чтобы мозаика выглядела одинаково при любом размере.
  const unit = targetW / WORD_REF;
  const shard = Math.max(6.5, SHARD * unit);
  const crack = Math.max(1.1, CRACK * unit);
  const family = `"Unbounded", "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const meter = rectCanvas(1, 1).getContext("2d");
  meter.font = `900 100px ${family}`;
  const fontPx = (100 * targetW) / meter.measureText(WORD).width;
  const pad = 10;
  const cw = Math.ceil((targetW + pad * 2 + fontPx * 0.3) * S);
  const ch = Math.ceil(fontPx * 1.8 * S);
  const g = rectCanvas(cw, ch).getContext("2d", { willReadFrequently: true });
  g.font = `900 ${fontPx * S}px ${family}`;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#000";
  g.fillText(WORD, pad * S, fontPx * 1.25 * S);
  const pixels = g.getImageData(0, 0, cw, ch).data;

  let minX = cw;
  let minY = ch;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (pixels[(y * cw + x) * 4 + 3] > 127) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("слово не нарисовалось");
  const margin = 2 * S;
  const left = Math.max(0, minX - margin);
  const top = Math.max(0, minY - margin);
  const W = Math.min(cw, maxX + 1 + margin) - left;
  const H = Math.min(ch, maxY + 1 + margin) - top;
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) inside[y * W + x] = pixels[((y + top) * cw + x + left) * 4 + 3] > 127 ? 1 : 0;
  }

  const seeds = scatterSeeds(inside, W, H, S, rand, shard);
  const cell = shard * 1.6;
  const gw = Math.ceil(W / S / cell) + 1;
  const gh = Math.ceil(H / S / cell) + 1;
  const buckets = Array.from({ length: gw * gh }, () => []);
  seeds.forEach((s, i) => buckets[Math.floor(s[1] / cell) * gw + Math.floor(s[0] / cell)].push(i));

  const map = new Uint8Array(W * H * 4);
  const stats = seeds.map(() => ({ n: 0, sx: 0, sy: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside[y * W + x]) continue;
      const px = (x + 0.5) / S;
      const py = (y + 0.5) / S;
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      let d1 = Infinity;
      let d2 = Infinity;
      let i1 = -1;
      let i2 = -1;
      for (let by = Math.max(0, cy - 1); by <= Math.min(gh - 1, cy + 1); by++) {
        for (let bx = Math.max(0, cx - 1); bx <= Math.min(gw - 1, cx + 1); bx++) {
          for (const i of buckets[by * gw + bx]) {
            const d = (seeds[i][0] - px) ** 2 + (seeds[i][1] - py) ** 2;
            if (d < d1) {
              d2 = d1;
              i2 = i1;
              d1 = d;
              i1 = i;
            } else if (d < d2) {
              d2 = d;
              i2 = i;
            }
          }
        }
      }
      if (i1 < 0) continue;
      // Трещина — полоса вдоль границы между двумя соседними осколками, у каждой пары своя ширина.
      if (i2 >= 0 && d2 - d1 < 60) {
        const between = Math.hypot(seeds[i2][0] - seeds[i1][0], seeds[i2][1] - seeds[i1][1]);
        const lo = Math.min(i1, i2);
        const hi = Math.max(i1, i2);
        const noise = Math.abs(Math.sin(lo * 12.9898 + hi * 78.233) * 43758.5453) % 1;
        if (d2 - d1 < crack * (0.7 + 0.8 * noise) * between) continue;
      }
      const k = (y * W + x) * 4;
      map[k] = i1 & 255;
      map[k + 1] = i1 >> 8;
      map[k + 3] = 255;
      const st = stats[i1];
      st.n++;
      st.sx += x;
      st.sy += y;
      if (x < st.x0) st.x0 = x;
      if (x > st.x1) st.x1 = x;
      if (y < st.y0) st.y0 = y;
      if (y > st.y1) st.y1 = y;
    }
  }

  // Размеры осколков в CSS-пикселях относительно центра слова. Совсем крошечные обломки выкидываем.
  const shards = [];
  const halfW = W / (2 * S);
  const halfH = H / (2 * S);
  stats.forEach((st, id) => {
    if (st.n < 6) {
      // стираем крошку с карты, чтобы она не торчала отдельным пятнышком
      for (let y = st.y0; y <= st.y1; y++) {
        for (let x = st.x0; x <= st.x1; x++) {
          const k = (y * W + x) * 4;
          if (map[k + 3] && (map[k] | (map[k + 1] << 8)) === id) map[k + 3] = 0;
        }
      }
      return;
    }
    const mx = (st.sx / st.n + 0.5) / S;
    const my = (st.sy / st.n + 0.5) / S;
    shards.push({
      id,
      cx: mx - halfW,
      cy: my - halfH,
      l: st.x0 / S - mx,
      t: st.y0 / S - my,
      w: (st.x1 + 1 - st.x0) / S,
      h: (st.y1 + 1 - st.y0) / S,
      box: [st.x0, st.y0, st.x1 + 1 - st.x0, st.y1 + 1 - st.y0],
    });
  });
  return { W, H, S, map, shards, half: [halfW, halfH] };
}

// Полёт каждого осколка: свой угол, дальность, время, вращение и кувырок. Осколки-«декорации» (ghost) копируют
// форму настоящих, но в слово не входят: долетают и гаснут.
function buildInstances(shards, textW, ringW, reachMax, rand) {
  const real = shards.length;
  const total = real + Math.round(real * GHOSTS);
  const list = [];
  for (let i = 0; i < total; i++) {
    const ghost = i >= real;
    const shard = ghost ? shards[Math.floor(rand() * real)] : shards[i];
    const angle = rand() * Math.PI * 2;
    const len = Math.hypot(shard.cx, shard.cy) || 1;
    const spread = (rand() - 0.5) * 0.7;
    const ux = shard.cx / len;
    const uy = shard.cy / len;
    const dist = reachMax * (0.45 + 0.9 * rand());
    const te = T_EXPAND * (0.45 + 0.55 * rand());
    list.push({
      shard,
      ghost,
      tier: ghost ? (rand() < 0.34 ? 0 : rand() < 0.55 ? 1 : 2) : 0,
      ca: Math.cos(angle),
      sa: Math.sin(angle),
      r0: ringW * (0.08 + 0.2 * rand()),
      reach: rand() < 0.12 ? ringW * 0.9 + rand() * reachMax : ringW * (0.55 + 0.95 * rand() ** 1.3),
      te,
      tg: te + 0.85 + 0.5 * rand(),
      bd: rand() * 0.22 + (len / textW) * 0.3,
      bx: (ux * Math.cos(spread) - uy * Math.sin(spread)) * dist,
      by: (ux * Math.sin(spread) + uy * Math.cos(spread)) * dist,
      angle0: (rand() - 0.5) * Math.PI * 2,
      spin: (rand() < 0.5 ? -1 : 1) * (4 + 6 * rand()),
      flip0: rand() * Math.PI * 2,
      flipRate: (rand() < 0.5 ? -1 : 1) * (3 + 6 * rand()),
      tone: ghost ? rand() * 0.3 : rand() * 0.2,
      scaleK: 0.5 + 1.1 * rand(),
      phase: rand() * Math.PI * 2,
      mul: ghost ? 0.35 + 1.15 * rand() : 0,
    });
  }
  // Дальние рисуются первыми, настоящие осколки слова — последними, поверх всех.
  const nearness = (inst) => (inst.ghost ? 3 - inst.tier : 4);
  return list.sort((a, b) => nearness(a) - nearness(b));
}

// Общее для обоих способов рисования: прозрачность кадра, «удар» при сборке и бегущий блик.
function frameParams(t, half) {
  const reach = half[0] * 0.9 + half[1] * 0.6 + 70;
  return {
    // Осколки не вспыхивают разом, а проступают за первые доли секунды; в конце всё растворяется.
    fade: (0.3 + 0.7 * smoothstep(0, 0.22, t)) * (1 - smoothstep(T_BURST + 0.12, T_BURST + 0.62, t)),
    // В момент сборки слово на миг «встряхивается»: осколки расходятся и трещины раскрываются.
    bump: 0.05 * Math.exp(-(((t - 1.9) / 0.07) ** 2)),
    // Блик пробегает по собранному слову слева направо, осколки вспыхивают по очереди.
    band: -reach + smoothstep(1.95, T_BURST - 0.1, t) * 2 * reach,
  };
}

// ---------- Основной способ рисования: WebGL ----------
// Положение осколка считает видеокарта; форма берётся из карты осколков: каждый осколок — прямоугольник вокруг
// своей части слова, а лишние пиксели (чужие осколки и трещины) отбрасываются по карте.

const num = (n) => Number(n).toFixed(4);

const VERTEX = `
precision highp float;
attribute vec4 a_geo;
attribute vec4 a_ring;
attribute vec4 a_time;
attribute vec4 a_burst;
attribute vec4 a_spin;
attribute vec4 a_misc;
uniform float u_t;
uniform vec2 u_view;
uniform vec2 u_center;
uniform vec2 u_texHalf;
uniform float u_fade;
uniform float u_band;
uniform float u_bump;
uniform float u_gain;
uniform float u_spread;
varying vec2 v_uv;
varying vec2 v_id;
varying float v_alpha;
varying float v_shade;
varying vec2 v_local;

float easeInOut(float u) {
  float k = -2.0 * u + 2.0;
  return u < 0.5 ? 4.0 * u * u * u : 1.0 - k * k * k * 0.5;
}

void main() {
  vec2 target = a_geo.zw;
  float te = a_time.x;
  float tg = a_time.y;
  float bd = a_time.z;
  float t = u_t;
  bool ghost = a_misc.z > 0.0;
  if (u_fade <= 0.0 || (ghost && t >= tg)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 pos;
  float ang;
  float flip;
  float moving = 1.0;
  if (t < te) {
    float k = 1.0 - t / te;
    pos = a_ring.xy * mix(a_ring.z, a_ring.w, 1.0 - k * k * k);
    ang = a_spin.x + a_spin.y * t;
    flip = a_spin.z + a_spin.w * t;
  } else if (t < tg) {
    float g = easeInOut((t - te) / (tg - te));
    pos = mix(a_ring.xy * a_ring.w, target, g);
    ang = (a_spin.x + a_spin.y * te) * (1.0 - g);
    flip = (a_spin.z + a_spin.w * te) * (1.0 - g);
  } else if (t < ${num(T_BURST)} + bd) {
    pos = target;
    ang = 0.0;
    flip = 0.0;
    moving = 0.0;
  } else {
    float u = clamp((t - ${num(T_BURST)} - bd) / 0.62, 0.0, 1.0);
    float e = u * u * u;
    pos = target + a_burst.xy * e;
    ang = a_spin.y * 0.9 * e;
    flip = a_spin.w * 1.2 * e;
  }
  pos = pos * (1.0 + u_bump * (1.0 - moving));
  // Чем дальше от слова, тем осколок ближе к зрителю и крупнее.
  float away = clamp((length(pos) - length(target)) / u_spread, 0.0, 1.0);
  float scale = (1.0 + a_burst.w * away) * (ghost ? a_misc.z : 1.0);
  // Кувырок: осколок поворачивается ребром к зрителю и показывает обратную сторону.
  float cf = cos(flip);
  cf = abs(cf) < 0.1 ? (cf < 0.0 ? -0.1 : 0.1) : cf;
  vec2 local = vec2(a_geo.x * cf, a_geo.y) * scale;
  float ca = cos(ang);
  float sa = sin(ang);
  vec2 px = u_center + pos + vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca);
  gl_Position = vec4(px.x / u_view.x * 2.0 - 1.0, 1.0 - px.y / u_view.y * 2.0, 0.0, 1.0);

  v_uv = (target + a_geo.xy + u_texHalf) / (2.0 * u_texHalf);
  float lo = mod(a_time.w, 256.0);
  v_id = vec2(lo, (a_time.w - lo) / 256.0) / 255.0;
  float tier = a_burst.z;
  float alpha = ghost ? (tier < 0.5 ? 1.0 : (tier < 1.5 ? 0.8 : 0.55)) : 1.0;
  alpha *= u_fade;
  if (ghost) alpha *= 1.0 - smoothstep(tg - 0.3, tg, t);
  v_alpha = alpha;
  // Оттенок: у каждого осколка свой, в полёте они бликуют гранями, в собранном слове по ним бежит блик.
  float facing = abs(cos(flip));
  float glint = pow(max(0.0, sin(flip * 2.0 + a_misc.y)), 8.0);
  float q = (target.x * 0.9 + target.y * 0.6 - u_band) / 48.0;
  float band = exp(-q * q);
  v_shade = clamp(a_misc.x + moving * ((1.0 - facing) * 0.3 + glint * 0.55) + (1.0 - moving) * band * u_gain, 0.0, 0.92);
  v_local = a_geo.xy;
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_map;
uniform vec3 u_ink;
uniform vec3 u_bg;
varying vec2 v_uv;
varying vec2 v_id;
varying float v_alpha;
varying float v_shade;
varying vec2 v_local;

void main() {
  vec4 m = texture2D(u_map, v_uv);
  if (m.a < 0.5) discard;
  if (abs(m.r - v_id.x) > 0.002 || abs(m.g - v_id.y) > 0.002) discard;
  float shade = clamp(v_shade - 0.011 * dot(v_local, vec2(0.7, 0.7)), 0.0, 0.95);
  vec3 col = mix(u_ink, u_bg, shade);
  gl_FragColor = vec4(col * v_alpha, v_alpha);
}`;

function parseColor(value, fallback) {
  const hex = value.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = parseInt(full, 16);
  return Number.isFinite(n) && full.length === 6 ? [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) : fallback;
}

// Возвращает { draw(t), resize(scale) } или null, если WebGL недоступен (тогда холст нужно заменить на свежий и рисовать плоско).
function glRenderer(canvas, word, list, view, colors, keepBuffer) {
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
  ["a_geo", "a_ring", "a_time", "a_burst", "a_spin", "a_misc"].forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // Каждый осколок — прямоугольник из двух треугольников; все свойства осколка лежат в вершинах, время приходит одним числом.
  const corners = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  const pad = 1 / word.S;
  const floats = 24;
  const data = new Float32Array(list.length * corners.length * floats);
  let o = 0;
  for (const inst of list) {
    const s = inst.shard;
    for (const [cx, cy] of corners) {
      const x = cx ? s.l + s.w + pad : s.l - pad;
      const y = cy ? s.t + s.h + pad : s.t - pad;
      data.set(
        [x, y, s.cx, s.cy, inst.ca, inst.sa, inst.r0, inst.reach, inst.te, inst.tg, inst.bd, s.id, inst.bx, inst.by, inst.tier, inst.scaleK, inst.angle0, inst.spin, inst.flip0, inst.flipRate, inst.tone, inst.phase, inst.mul, 0],
        o,
      );
      o += floats;
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (let i = 0; i < 6; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 4, gl.FLOAT, false, floats * 4, i * 16);
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, word.W, word.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, word.map);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const uniform = (name) => gl.getUniformLocation(program, name);
  const at = { t: uniform("u_t"), fade: uniform("u_fade"), band: uniform("u_band"), bump: uniform("u_bump") };
  gl.uniform1i(uniform("u_map"), 0);
  gl.uniform2f(uniform("u_view"), view.width, view.height);
  gl.uniform2f(uniform("u_center"), view.cx, view.cy);
  gl.uniform2f(uniform("u_texHalf"), word.half[0], word.half[1]);
  gl.uniform1f(uniform("u_spread"), view.spread);
  gl.uniform1f(uniform("u_gain"), colors.gain);
  gl.uniform3fv(uniform("u_ink"), colors.ink);
  gl.uniform3fv(uniform("u_bg"), colors.bg);
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
      const { fade, bump, band } = frameParams(t, word.half);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (fade <= 0) return;
      gl.uniform1f(at.t, t);
      gl.uniform1f(at.fade, fade);
      gl.uniform1f(at.band, band);
      gl.uniform1f(at.bump, bump);
      gl.drawArrays(gl.TRIANGLES, 0, list.length * corners.length);
    },
  };
}

// ---------- Запасной способ рисования: плоский холст ----------
// Те же формулы полёта, осколки рисуются готовыми картинками из атласа (по одной на осколок).

function atlasFor(word, ink) {
  const side = 2048;
  let x = 0;
  let y = 0;
  let row = 0;
  const canvas = rectCanvas(side, side);
  const g = canvas.getContext("2d");
  const [r, green, b] = ink.map((v) => Math.round(v * 255));
  for (const s of word.shards) {
    const [bx, by, bw, bh] = s.box;
    if (x + bw > side) {
      x = 0;
      y += row + 1;
      row = 0;
    }
    if (y + bh > side) break;
    const image = g.createImageData(bw, bh);
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        const k = ((by + j) * word.W + bx + i) * 4;
        if (word.map[k + 3] && (word.map[k] | (word.map[k + 1] << 8)) === s.id) {
          const m = (j * bw + i) * 4;
          image.data[m] = r;
          image.data[m + 1] = green;
          image.data[m + 2] = b;
          image.data[m + 3] = 255;
        }
      }
    }
    g.putImageData(image, x, y);
    s.atlas = [x, y, bw, bh];
    x += bw + 1;
    row = Math.max(row, bh);
  }
  return canvas;
}

// Где осколок и как повёрнут в момент t: то же, что считает вершинный шейдер.
function pose(inst, t, out) {
  const s = inst.shard;
  out.moving = 1;
  if (t < inst.te) {
    const k = 1 - t / inst.te;
    const r = inst.r0 + (inst.reach - inst.r0) * (1 - k * k * k);
    out.x = inst.ca * r;
    out.y = inst.sa * r;
    out.ang = inst.angle0 + inst.spin * t;
    out.flip = inst.flip0 + inst.flipRate * t;
  } else if (t < inst.tg) {
    const g = easeInOutCubic((t - inst.te) / (inst.tg - inst.te));
    const sx = inst.ca * inst.reach;
    const sy = inst.sa * inst.reach;
    out.x = sx + (s.cx - sx) * g;
    out.y = sy + (s.cy - sy) * g;
    out.ang = (inst.angle0 + inst.spin * inst.te) * (1 - g);
    out.flip = (inst.flip0 + inst.flipRate * inst.te) * (1 - g);
  } else if (t < T_BURST + inst.bd) {
    out.x = s.cx;
    out.y = s.cy;
    out.ang = 0;
    out.flip = 0;
    out.moving = 0;
  } else {
    const u = clamp01((t - T_BURST - inst.bd) / 0.62);
    const e = u * u * u;
    out.x = s.cx + inst.bx * e;
    out.y = s.cy + inst.by * e;
    out.ang = inst.spin * 0.9 * e;
    out.flip = inst.flipRate * 1.2 * e;
  }
}

function canvasRenderer(canvas, word, list, view, colors) {
  const ctx = canvas.getContext("2d");
  const atlas = atlasFor(word, colors.ink);
  const out = {};
  let scale = 1;
  return {
    resize(next) {
      scale = next;
      canvas.width = Math.round(view.width * view.dpr * scale);
      canvas.height = Math.round(view.height * view.dpr * scale);
    },
    draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { fade, bump, band } = frameParams(t, word.half);
      if (fade <= 0) return;
      const k = view.dpr * scale;
      for (const inst of list) {
        const s = inst.shard;
        if (!s.atlas || (inst.ghost && t >= inst.tg)) continue;
        pose(inst, t, out);
        const grow = 1 + bump * (1 - out.moving);
        const x = out.x * grow;
        const y = out.y * grow;
        const away = clamp01((Math.hypot(x, y) - Math.hypot(s.cx, s.cy)) / view.spread);
        const size = (1 + inst.scaleK * away) * (inst.ghost ? inst.mul : 1);
        let cf = Math.cos(out.flip);
        if (Math.abs(cf) < 0.1) cf = cf < 0 ? -0.1 : 0.1;
        const cos = Math.cos(out.ang);
        const sin = Math.sin(out.ang);
        const q = (s.cx * 0.9 + s.cy * 0.6 - band) / 48;
        const shade = Math.min(0.9, inst.tone + (out.moving ? (1 - Math.abs(Math.cos(out.flip))) * 0.3 : Math.exp(-q * q) * colors.gain));
        const ghostAlpha = inst.ghost ? [1, 0.8, 0.55][inst.tier] * (1 - smoothstep(inst.tg - 0.3, inst.tg, t)) : 1;
        ctx.globalAlpha = ghostAlpha * fade * (1 - shade * 0.7);
        ctx.setTransform(k * cos * cf * size, k * sin * cf * size, -k * sin * size, k * cos * size, k * (view.cx + x), k * (view.cy + y));
        ctx.drawImage(atlas, s.atlas[0], s.atlas[1], s.atlas[2], s.atlas[3], s.l, s.t, s.w, s.h);
      }
      ctx.globalAlpha = 1;
    },
  };
}

// Показывает заставку и возвращает промис, который завершается, когда она убрана.
// onReveal вызывается в момент, когда слово разлетается и под ним должно проявиться приложение.
// onPulse(сила) вызывается в такт анимации — туда подключается вибрация телефона.
export async function playIntro({ onReveal = () => {}, onPulse = () => {} } = {}) {
  const root = document.getElementById("intro");
  let canvas = root?.querySelector("canvas");
  const finish = () => {
    root?.remove();
    onReveal();
  };
  const params = new URLSearchParams(location.search);
  const frozen = Number(params.get("introT"));
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!root || !canvas || !canvas.getContext || (reduce && !frozen)) return finish();

  const css = getComputedStyle(document.documentElement);
  const colors = {
    ink: parseColor(css.getPropertyValue("--intro-ink").trim(), [0.04, 0.04, 0.05]),
    bg: parseColor(css.getPropertyValue("--bg").trim(), [0.98, 0.98, 0.98]),
  };
  // Блик на светлой теме осветляет чёрные осколки; на тёмной белые осколки можно только слегка притушить, поэтому слабее.
  colors.gain = colors.ink[0] > 0.5 ? 0.3 : 0.6;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ringW = Math.round(Math.min(width * 0.86, 440)); // от него считается размах разлёта осколков
  const textW = Math.round(Math.min(width * 0.72, 370)); // само слово чуть меньше прежнего
  const reachMax = Math.hypot(width, height) * 0.62;
  const view = { width, height, dpr: Math.min(window.devicePixelRatio || 1, 3), cx: width / 2, cy: height / 2 - height * 0.03, spread: reachMax * 0.9 };
  const fit = () => {
    canvas.width = Math.round(width * view.dpr);
    canvas.height = Math.round(height * view.dpr);
  };
  fit();

  const rand = mulberry32(20251025);
  let word;
  let list;
  try {
    word = await buildWord(textW, Math.max(2, Math.round(view.dpr)), rand);
    list = buildInstances(word.shards, textW, ringW, reachMax, rand);
  } catch {
    return finish();
  }

  // WebGL, а если его нет (или шейдеры не собрались) — плоский холст на свежем элементе.
  let renderer = params.has("intro2d") ? null : glRenderer(canvas, word, list, view, colors, Boolean(frozen));
  if (!renderer) {
    const fresh = canvas.cloneNode(false);
    canvas.replaceWith(fresh);
    canvas = fresh;
    view.dpr = Math.min(view.dpr, 2);
    fit();
    renderer = canvasRenderer(canvas, word, list, view, colors);
  }

  if (frozen) {
    renderer.draw(frozen);
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
          renderer.resize(0.6);
        }
      }
      previous = now;
      renderer.draw(t);
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
