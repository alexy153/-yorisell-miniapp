// Yorisell — приложение покупателя. Работает внутри Telegram и в обычном браузере (без входа).
// Данные берём с сервера (/api). Избранное — в облачном хранилище Telegram, в браузере — в памяти браузера.

import { playIntro } from "./intro.js";
import { haptic, installTapFeedback } from "./haptics.js";

const tg = window.Telegram?.WebApp;
// Telegram-скрипт загружается и в обычном браузере, поэтому проверяем, что приложение открыто внутри Telegram.
const inTelegram = Boolean(tg && tg.platform && tg.platform !== "unknown");
const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const TABS = ["favorites", "catalog", "info"];
const FAV_KEY = "favorites";
// Новое имя ключа: ранее сохранённый при проверках тёмный режим сбрасывается, и первый запуск у всех белый.
const THEME_KEY = "yorisell-theme";
const SELLER = "https://t.me/Alexy153";
const REVIEWS = "https://www.avito.ru/brands/f9610b6b4e6fd344c27c2197bf03b0be?src=sharing";
const THEME_BG = { light: "#FAFAFA", dark: "#0A0A0B" };
const SORTS = { new: "Новые", cheap: "Дешевле", pricey: "Дороже" };
const SORT_ORDER = ["new", "cheap", "pricey"];
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const MARQUEE = ["Джинсы", "Отправка в день заказа", "Более 150 отзывов", "Всегда на связи"];

const svg = (inner, attrs = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${attrs}>${inner}</svg>`;

const ICON = {
  heart: svg(`<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>`),
  search: svg(`<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>`, 'stroke-width="2"'),
  chevron: svg(`<path d="M9 18l6-6-6-6"/>`, 'stroke-width="2"'),
  back: svg(`<path d="M15 18l-6-6 6-6"/>`, 'stroke-width="2"'),
  moon: svg(`<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/>`, 'class="moon"'),
  sun: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`, 'class="sun"'),
  star: svg(`<path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z"/>`),
  bolt: svg(`<path d="M13.6 2L4.5 13.6h6.1L9.4 22l10.1-12h-6.2z"/>`),
  chat: svg(`<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H17.5A2.5 2.5 0 0 1 20 5.5V13.5A2.5 2.5 0 0 1 17.5 16H9.5L5.5 19.5V16H6.5A2.5 2.5 0 0 1 4 13.5Z"/><circle class="dot" cx="8.5" cy="9.5" r="1" fill="currentColor"/><circle class="dot d2" cx="12" cy="9.5" r="1" fill="currentColor"/><circle class="dot d3" cx="15.5" cy="9.5" r="1" fill="currentColor"/>`),
  refresh: svg(`<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5V9h-4.5"/>`),
};

const state = {
  tab: "catalog",
  category: "all",
  size: "all",
  sort: "new",
  query: "",
  catalog: null,
  favorites: [],
  details: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const rub = (amount) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, REDUCED ? 0 : ms));

async function api(path, init) {
  const response = await fetch(path, { headers: { accept: "application/json" }, ...init });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

// Анонимные счётчики: без личных данных, ошибки игнорируем.
function track(kind, itemId = 0) {
  const body = JSON.stringify(itemId ? { kind, itemId } : { kind });
  fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}

// ---------- Избранное: облако Telegram, а в браузере — память браузера ----------

function parseFavorites(raw) {
  try {
    const list = JSON.parse(raw || "[]");
    return Array.isArray(list) ? list.filter((id) => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

function readLocal() {
  try {
    return parseFavorites(localStorage.getItem(FAV_KEY));
  } catch {
    return [];
  }
}

// Если облако не ответило за 800 мс, берём список из памяти браузера, чтобы каталог открылся всегда.
function loadFavorites() {
  const cloud = inTelegram ? tg.CloudStorage : null;
  if (!cloud?.getItem) return Promise.resolve(readLocal());
  const fromCloud = new Promise((resolve) => {
    cloud.getItem(FAV_KEY, (error, value) => resolve(error ? readLocal() : parseFavorites(value)));
  });
  const fallback = new Promise((resolve) => setTimeout(() => resolve(readLocal()), 800));
  return Promise.race([fromCloud, fallback]);
}

function saveFavorites(list) {
  const raw = JSON.stringify(list);
  try {
    localStorage.setItem(FAV_KEY, raw);
  } catch {
    /* память браузера недоступна — в Telegram список всё равно сохранится в облаке */
  }
  if (inTelegram) tg.CloudStorage?.setItem?.(FAV_KEY, raw, () => {});
}

// ---------- Telegram и тема ----------

function setupTelegram() {
  if (!inTelegram) return;
  const steps = [() => tg.ready(), () => tg.expand(), () => tg.disableVerticalSwipes?.(), () => tg.requestFullscreen?.()];
  for (const step of steps) {
    try {
      Promise.resolve(step()).catch(() => {});
    } catch {
      /* старые версии Telegram не знают некоторых вызовов */
    }
  }
}

const currentTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function paintTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const bg = THEME_BG[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  if (!inTelegram) return;
  for (const call of ["setHeaderColor", "setBackgroundColor", "setBottomBarColor"]) {
    try {
      tg[call]?.(bg);
    } catch {
      /* старые версии Telegram не знают этого вызова */
    }
  }
}

// Смена темы: новый вид расходится кругом от кнопки (там, где поддерживается), выбор запоминается.
function toggleTheme(button) {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* без памяти браузера тема просто не запомнится */
  }
  if (!document.startViewTransition || REDUCED) return paintTheme(next);
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(() => paintTheme(next));
  transition.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
}

const themeButtonHtml = () => `<button class="theme-btn" type="button" data-theme-toggle aria-label="Сменить тему">${ICON.moon}${ICON.sun}</button>`;

// ---------- Появление элементов, счётчики, подложка категорий ----------

// Карточки появляются, когда доезжают до экрана; одновременно появившиеся идут друг за другом.
const revealObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          let order = 0;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.style.setProperty("--d", `${Math.min(order++, 8) * 70}ms`);
            entry.target.classList.add("in");
            revealObserver.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -4% 0px", threshold: 0.04 },
      )
    : null;

function watchReveals(root) {
  for (const el of root.querySelectorAll(".reveal:not(.in)")) {
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add("in");
  }
}

function markImage(img) {
  img.classList.add("is-ready");
  img.parentElement?.classList.add("is-ready");
}

// Картинки, уже загруженные из кэша, событие load может не успеть показать.
function markLoaded(root) {
  for (const img of root.querySelectorAll("img")) {
    if (img.complete && img.naturalWidth > 0) markImage(img);
  }
}

function countUps(root) {
  for (const el of root.querySelectorAll("[data-count]")) {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix ?? "";
    if (REDUCED || !Number.isFinite(target)) {
      el.textContent = `${el.dataset.count}${suffix}`;
      continue;
    }
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / 1100);
      el.textContent = `${Math.round(target * (1 - (1 - progress) ** 3))}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// Чёрная подложка под выбранной категорией плавно переезжает к новой.
function moveGlider(scroll = true) {
  const nav = $("#pills");
  const glider = nav?.querySelector(".glider");
  const active = nav?.querySelector(".pill.is-active");
  if (!glider || !active) return;
  glider.style.width = `${active.offsetWidth}px`;
  glider.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!glider.classList.contains("is-ready")) requestAnimationFrame(() => glider.classList.add("is-ready"));
  if (scroll) nav.scrollTo({ left: Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2), behavior: REDUCED ? "auto" : "smooth" });
}

function afterRender(root) {
  watchReveals(root);
  markLoaded(root);
  countUps(root);
  moveGlider(false);
  document.fonts?.ready.then(() => moveGlider(false));
}

// ---------- Вкладки ----------

function setTabbar(tab) {
  const bar = $(".tabbar");
  bar.style.setProperty("--i", TABS.indexOf(tab) + 1);
  for (const button of document.querySelectorAll(".tab")) {
    if (button.dataset.tab === tab) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

async function swapView(render, direction) {
  const view = $("#view");
  view.style.setProperty("--dx", `${direction * -16}px`);
  view.classList.add("is-leaving");
  await pause(150);
  view.innerHTML = skeletonHtml();
  await render();
  window.scrollTo(0, 0);
  view.classList.remove("is-leaving");
}

async function switchTab(tab) {
  if (tab === state.tab) return;
  const direction = Math.sign(TABS.indexOf(tab) - TABS.indexOf(state.tab));
  state.tab = tab;
  setTabbar(tab);
  await swapView(() => renderTab(tab), direction);
}

// gate — необязательное ожидание (заставка): страница строится сразу, а показывается, когда заставка уходит.
async function renderTab(tab, gate = null) {
  const view = $("#view");
  let html;
  try {
    if (tab === "catalog") {
      if (!state.catalog) state.catalog = await api("/api/catalog");
      html = catalogHtml();
    } else if (tab === "favorites") {
      html = await favoritesHtml();
    } else {
      html = infoHtml();
    }
  } catch {
    html = `<p class="subtitle">Не удалось загрузить данные.</p>
      <button class="btn btn-ghost retry" type="button" data-retry>Повторить</button>`;
  }
  if (gate) await gate;
  view.innerHTML = html;
  afterRender(view);
}

function skeletonHtml() {
  return `<div class="skeleton-grid" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
}

// ---------- Каталог ----------

function topHtml() {
  return `
    <header class="top rise">
      <img class="top-ava" src="assets/logo-s.webp" alt="">
      <div class="top-name"><b>Yorisell</b><span>Джинсы · отправка в день заказа</span></div>
      ${themeButtonHtml()}
    </header>`;
}

function bannerHtml() {
  const words = MARQUEE.map((text, i) => `<span${i % 2 ? ' class="o"' : ""}>${esc(text)}</span>`).join("");
  return `
    <section class="banner rise" style="--d:90ms">
      <span class="banner-tag">24/7</span>
      <div class="marquee" aria-hidden="true"><div class="marquee-track">${words}${words}</div></div>
      <p class="banner-title">Регулярное обновление ассортимента</p>
      <button class="btn btn-sm btn-sheen" type="button" data-scroll="feed">Смотреть каталог</button>
    </section>`;
}

function catalogHtml() {
  return `
    ${topHtml()}
    ${bannerHtml()}
    <nav class="pills rise" id="pills" style="--d:170ms" aria-label="Категории"><span class="glider"></span>${pillsHtml()}</nav>
    <label class="search rise" style="--d:230ms">
      ${ICON.search}
      <input id="search" type="search" placeholder="Поиск по названию" aria-label="Поиск по названию" value="${esc(state.query)}" autocomplete="off">
    </label>
    <div class="chips rise" id="chips" style="--d:280ms" aria-label="Размер">${chipsHtml()}</div>
    <div id="feed">${feedHtml(true)}</div>`;
}

function pillsHtml() {
  return state.catalog.categories
    .map(
      (cat) => `
      <button class="pill${cat.key === state.category ? " is-active" : ""}" type="button" data-cat="${esc(cat.key)}" aria-pressed="${cat.key === state.category}">
        <span>${esc(cat.title)}</span><span class="pill-count">${cat.count}</span>
      </button>`,
    )
    .join("");
}

function inCategory(item) {
  return state.category === "all" || item.category === state.category;
}

function sizeRank(size) {
  const number = parseFloat(size);
  if (Number.isFinite(number)) return [0, number, ""];
  const letter = SIZE_ORDER.indexOf(String(size).toUpperCase());
  return letter >= 0 ? [1, letter, ""] : [2, 0, String(size)];
}

function sizeCompare(a, b) {
  const [ga, na, sa] = sizeRank(a);
  const [gb, nb, sb] = sizeRank(b);
  return ga - gb || na - nb || sa.localeCompare(sb);
}

// Размеры, которые есть в выбранной категории (для джинсов это ширина пояса, для остального — S/M/L).
function sizeOptions() {
  const sizes = new Set(state.catalog.items.filter((item) => inCategory(item) && item.size).map((item) => item.size));
  return [...sizes].sort(sizeCompare);
}

function chipsHtml() {
  const sizes = sizeOptions();
  if (sizes.length < 2) return "";
  const chip = (value, label) =>
    `<button class="chip${state.size === value ? " is-active" : ""}" type="button" data-size="${esc(value)}" aria-pressed="${state.size === value}">${esc(label)}</button>`;
  return chip("all", "Все размеры") + sizes.map((size) => chip(size, size)).join("");
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  const items = state.catalog.items.filter(
    (item) => inCategory(item) && (state.size === "all" || item.size === state.size) && (!query || item.title.toLowerCase().includes(query)),
  );
  if (state.sort === "cheap") return [...items].sort((a, b) => a.priceRub - b.priceRub);
  if (state.sort === "pricey") return [...items].sort((a, b) => b.priceRub - a.priceRub);
  return items;
}

// «Новинки» показываем, пока ничего не отфильтровано: это свежие поступления сверху каталога.
// В совсем маленьком каталоге полка только повторила бы всю сетку, поэтому её нет.
const MIN_FOR_SHELF = 9;

function freshItems() {
  if (state.category !== "all" || state.size !== "all" || state.query.trim()) return [];
  if (state.catalog.items.length < MIN_FOR_SHELF) return [];
  return state.catalog.items.filter((item) => !item.sold).slice(0, 8);
}

function feedHtml(animate) {
  const items = visibleItems();
  const fresh = freshItems();
  const rail = fresh.length
    ? `<section id="shelf">
         <div class="sec-head"><div><h2>Новинки</h2><p>Свежие поступления</p></div><button class="btn btn-sm" type="button" data-scroll="grid-sec">Весь каталог</button></div>
         <div class="rail">${fresh.map((item, index) => cardHtml(item, { animate, eager: index < 3 })).join("")}</div>
       </section>`
    : "";
  return `${rail}
    <section id="grid-sec">
      <div class="sec-head">
        <h2>Весь каталог <span class="count">${items.length}</span></h2>
        <button class="sort" type="button" data-sort aria-label="Сортировка">⇅ ${SORTS[state.sort]}</button>
      </div>
      <div class="grid" id="grid" aria-live="polite">${gridHtml(items, animate, !fresh.length)}</div>
    </section>`;
}

function gridHtml(items, animate, eagerFirst) {
  if (items.length === 0) return `<p class="grid-empty">Ничего не нашлось. Попробуйте другое название, размер или категорию.</p>`;
  return items.map((item, index) => cardHtml(item, { animate, eager: eagerFirst && index < 4 })).join("");
}

function renderFeed(animate) {
  const feed = $("#feed");
  if (!feed) return;
  feed.innerHTML = feedHtml(animate);
  watchReveals(feed);
  markLoaded(feed);
}

// Без подписей поверх фото: если картинки нет, остаётся ровный серый фон плитки.
// В карточке берётся маленькая версия (540 px), выбор между версиями делает браузер по плотности экрана.
// Первые карточки грузятся сразу и с высоким приоритетом, остальные — по мере прокрутки.
function photoHtml(cover, priority = false) {
  if (!cover) return "";
  const loading = priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const srcset = `${esc(cover.small)} 540w, ${esc(cover.large)} 1000w`;
  return `<img src="${esc(cover.small)}" srcset="${srcset}" sizes="(max-width: 480px) 45vw, 200px" alt="" decoding="async" ${loading} data-fallback>`;
}

function cardHtml(item, { animate = true, eager = false } = {}) {
  const on = state.favorites.includes(item.id);
  return `
    <article class="card reveal${animate ? "" : " in"}${item.sold ? " is-sold" : ""}">
      <button class="card-link" type="button" data-open="${item.id}" aria-label="${esc(item.title)}, ${rub(item.priceRub)}"></button>
      <div class="photo${item.cover ? "" : " is-ready"}">
        ${photoHtml(item.cover, eager)}
        ${item.size ? `<span class="size-badge">${esc(item.size)}</span>` : ""}
        <button class="heart${on ? " is-on" : ""}" type="button" data-fav="${item.id}" aria-pressed="${on}" aria-label="В избранное">${ICON.heart}</button>
        ${item.sold ? '<span class="sold-tag">Нет в наличии</span>' : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(item.title)}</div>
        <div class="price">${rub(item.priceRub)}</div>
      </div>
    </article>`;
}

// ---------- Избранное ----------

async function favoritesHtml() {
  const ids = state.favorites;
  if (ids.length === 0) return emptyFavoritesHtml();
  const { items } = await api(`/api/items?ids=${ids.join(",")}`);
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  if (ordered.length === 0) return emptyFavoritesHtml();
  return `
    <header class="row-head head rise">
      <h1 class="title">Избранное</h1>
      <span class="count-pill">${ordered.length}</span>
    </header>
    <section class="grid favorites-grid">${ordered.map((item, index) => cardHtml(item, { eager: index < 4 })).join("")}</section>`;
}

function emptyFavoritesHtml() {
  return `
    <header class="head rise"><h1 class="title">Избранное</h1></header>
    <section class="empty rise" style="--d:100ms">
      <div class="heart-ring">${ICON.heart}</div>
      <p>Нажмите сердечко на товаре, чтобы сохранить его здесь</p>
      <button class="btn" type="button" data-goto="catalog">Перейти в каталог</button>
    </section>`;
}

// ---------- Инфо ----------

function infoHtml() {
  const total = state.catalog?.items.length;
  const why = [
    ["star", "Более 150 положительных отзывов"],
    ["bolt", "Отправка в день заказа"],
    ["chat", "Всегда на связи"],
    ["refresh", "Регулярное обновление ассортимента"],
  ];
  return `
    <section class="shop rise">
      ${themeButtonHtml()}
      <div class="shop-ava"><img src="assets/logo-s.webp" alt="Логотип Yorisell"></div>
      <h1 class="shop-name">Yorisell</h1>
      <p class="shop-sub">Часы работы: 24/7</p>
      <a class="btn btn-sheen" href="${SELLER}" data-tg-link>Написать продавцу</a>
    </section>

    <div class="stats4">
      <div class="stat reveal"><small>Отзывы</small><b data-count="150" data-suffix="+">150+</b></div>
      <div class="stat reveal"><small>В наличии</small><b${Number.isFinite(total) ? ` data-count="${total}"` : ""}>${Number.isFinite(total) ? total : "—"}</b></div>
      <div class="stat reveal"><small>Часы работы</small><b>24/7</b></div>
      <div class="stat reveal"><small>Отправка</small><b style="font-size:14px;line-height:1.5">В день заказа</b></div>
    </div>

    <h2 class="section-title">Почему мы?</h2>
    <div class="why">
      ${why.map(([icon, text]) => `<div class="why-item reveal"><span class="ico ico-${icon}">${ICON[icon]}</span><span>${esc(text)}</span></div>`).join("")}
    </div>

    <a class="list-row reveal" href="${REVIEWS}" target="_blank" rel="noopener">
      <span><b>Отзывы</b><span>Открыть на Avito</span></span>
      ${ICON.chevron}
    </a>`;
}

// ---------- Карточка товара ----------

function productHtml(item) {
  const on = state.favorites.includes(item.id);
  const gallery = item.gallery.length
    ? `<div class="p-gallery">
         <div class="gallery-track" id="gallery">
           ${item.gallery.map((pair, i) => `<img src="${esc(pair.large)}" srcset="${esc(pair.small)} 540w, ${esc(pair.large)} 1000w" sizes="(max-width: 480px) 100vw, 480px" alt="${esc(item.title)}, фото ${i + 1}" data-zoom="${esc(pair.large)}" data-fallback decoding="async" loading="${i === 0 ? "eager" : "lazy"}">`).join("")}
         </div>
         ${item.gallery.length > 1 ? `<div class="dots" id="dots">${item.gallery.map((_, i) => `<span class="dot${i === 0 ? " is-active" : ""}"></span>`).join("")}</div>` : ""}
       </div>`
    : `<div class="p-gallery"></div>`;

  const booking = item.sold
    ? `<span class="btn btn-ghost buy-main" aria-disabled="true">Нет в наличии</span>`
    : `<a class="btn btn-sheen buy-main" href="${esc(item.bookingUrl)}" data-book="${item.id}" data-tg-link>Забронировать</a>`;

  return `
    ${gallery}
    <div class="p-info">
      <h1 class="p-title rise" id="sheet-title" style="--d:120ms">${esc(item.title)}</h1>
      <p class="p-sub rise" style="--d:160ms">${item.condition ? `Состояние ${esc(item.condition)}` : ""}${item.fit ? `${item.condition ? " · " : ""}Фит ${esc(item.fit)}` : ""}</p>
      <div class="stats rise" style="--d:200ms">
        <div class="cell"><small>Цена</small><b>${rub(item.priceRub)}</b></div>
        <div class="cell"><small>Размер</small><b>${esc(item.size ?? "—")}</b></div>
        <div class="cell"><small>Наличие</small><b>${item.sold ? "Нет" : "Есть"}</b></div>
      </div>
      <section class="desc rise" style="--d:260ms">
        <h2>Описание</h2>
        <p>${esc(item.description ?? "Подробности уточните в личке.")}</p>
      </section>
    </div>
    <div class="buybar">
      <button class="heart${on ? " is-on" : ""}" type="button" data-fav="${item.id}" aria-pressed="${on}" aria-label="В избранное">${ICON.heart}</button>
      <a class="btn btn-ghost buy-measure" href="${esc(item.measureUrl)}" data-tg-link>Замеры</a>
      ${booking}
    </div>`;
}

async function openItem(id) {
  const sheet = $("#sheet");
  const body = $("#sheet-body");
  body.innerHTML = `<div class="skeleton-grid" style="grid-template-columns:1fr"><div class="skeleton" style="aspect-ratio:3/4"></div></div>`;
  showSheet();
  track("open", id);
  // В Telegram назад ведёт его собственная кнопка «Назад», своего круга в углу нет; в обычном браузере её нет, поэтому там круг остаётся.
  const back = inTelegram ? "" : `<button class="back" type="button" data-close aria-label="Назад">${ICON.back}</button>`;
  try {
    const item = state.details.get(id) ?? (await api(`/api/items/${id}`));
    state.details.set(id, item);
    body.innerHTML = back + productHtml(item);
    bindGallery();
    markLoaded(body);
  } catch {
    body.innerHTML = `${back}<p class="subtitle" style="padding:88px 20px 0">Этот товар сейчас недоступен.</p>`;
  }
  sheet.scrollTop = 0;
}

let backHandler = null;

function showSheet() {
  const sheet = $("#sheet");
  sheet.hidden = false;
  sheet.classList.remove("is-closing");
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("is-open")));
  if (inTelegram && tg.BackButton) {
    backHandler = () => {
      haptic("light");
      hideSheet();
    };
    tg.BackButton.onClick(backHandler);
    tg.BackButton.show();
  }
}

async function hideSheet() {
  const sheet = $("#sheet");
  if (sheet.hidden) return;
  sheet.classList.remove("is-open");
  sheet.classList.add("is-closing");
  if (inTelegram && tg.BackButton) {
    tg.BackButton.hide();
    if (backHandler) tg.BackButton.offClick(backHandler);
    backHandler = null;
  }
  await pause(300);
  sheet.hidden = true;
  sheet.classList.remove("is-closing");
}

function bindGallery() {
  const track = $("#gallery");
  if (!track) return;
  track.addEventListener(
    "scroll",
    () => {
      const index = Math.round(track.scrollLeft / track.clientWidth);
      document.querySelectorAll("#dots .dot").forEach((dot, i) => dot.classList.toggle("is-active", i === index));
    },
    { passive: true },
  );
}

// ---------- Избранное: сердечко ----------

async function toggleFavorite(id) {
  const on = !state.favorites.includes(id);
  state.favorites = on ? [...state.favorites, id] : state.favorites.filter((x) => x !== id);
  saveFavorites(state.favorites);
  track(on ? "favorite" : "unfavorite", id);

  for (const button of document.querySelectorAll(`[data-fav="${id}"]`)) {
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
    button.classList.remove("is-pulse");
    void button.offsetWidth; // перезапускаем короткую анимацию
    button.classList.add("is-pulse");
  }

  if (state.tab === "favorites" && !on) {
    const view = $("#view");
    view.innerHTML = await favoritesHtml();
    afterRender(view);
  }
}

// ---------- События ----------

function openLink(link, event) {
  const href = link.getAttribute("href");
  if (link.dataset.book) track("book", Number(link.dataset.book));
  if (inTelegram && tg.openTelegramLink && href?.startsWith("https://t.me/")) {
    event.preventDefault();
    tg.openTelegramLink(href);
    return;
  }
  link.target = "_blank";
  link.rel = "noopener";
}

function selectCategory(key) {
  state.category = key;
  if (state.size !== "all" && !sizeOptions().includes(state.size)) state.size = "all";
  for (const pill of document.querySelectorAll(".pill")) {
    const on = pill.dataset.cat === key;
    pill.classList.toggle("is-active", on);
    pill.setAttribute("aria-pressed", String(on));
  }
  moveGlider();
  $("#chips").innerHTML = chipsHtml();
  renderFeed(true);
}

function selectSize(size) {
  state.size = size;
  for (const chip of document.querySelectorAll(".chip")) {
    const on = chip.dataset.size === size;
    chip.classList.toggle("is-active", on);
    chip.setAttribute("aria-pressed", String(on));
  }
  renderFeed(true);
}

// Нажатие на любую кнопку, ссылку или переключатель даёт отклик; новые кнопки получают его сами. Сила — по роли элемента.
function tapStyle(control) {
  // Повторное нажатие на текущую вкладку — лёгкий отклик, переключение — плотнее.
  if (control.matches(".tab")) return control.dataset.tab === state.tab ? "soft" : "medium";
  // «Лайк» плотнее, чем снятие отметки (состояние ещё не изменилось: правило срабатывает раньше обработчика).
  if (control.matches("[data-fav]")) return state.favorites.includes(Number(control.dataset.fav)) ? "light" : "medium";
  // Переходы и действия: товар, каталог, бронь, замеры, чат с продавцом.
  if (control.matches("[data-open], [data-goto], [data-tg-link]")) return "medium";
  // Остальное: категории, размеры, сортировка, тема, «назад», фото, «повторить», отзывы.
  return "light";
}

// Фото в галерее и тёмная подложка просмотра — кликабельны, хотя это не кнопки.
installTapFeedback({ style: tapStyle, find: (target) => target.closest("[data-zoom], #zoom") });

document.addEventListener("click", (event) => {
  const target = event.target;
  const hit = (selector) => target.closest(selector);

  const tab = hit(".tab");
  if (tab) return switchTab(tab.dataset.tab);

  const fav = hit("[data-fav]");
  if (fav) {
    event.preventDefault();
    event.stopPropagation();
    return toggleFavorite(Number(fav.dataset.fav));
  }

  const theme = hit("[data-theme-toggle]");
  if (theme) return toggleTheme(theme);

  const cat = hit("[data-cat]");
  if (cat) return selectCategory(cat.dataset.cat);

  const size = hit("[data-size]");
  if (size) return selectSize(size.dataset.size);

  if (hit("[data-sort]")) {
    state.sort = SORT_ORDER[(SORT_ORDER.indexOf(state.sort) + 1) % SORT_ORDER.length];
    return renderFeed(true);
  }

  const scroll = hit("[data-scroll]");
  if (scroll) {
    document.getElementById(scroll.dataset.scroll)?.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    return;
  }

  const open = hit("[data-open]");
  if (open) return openItem(Number(open.dataset.open));

  if (hit("[data-close]")) return hideSheet();

  const goto = hit("[data-goto]");
  if (goto) return switchTab(goto.dataset.goto);

  const retry = hit("[data-retry]");
  if (retry) {
    state.catalog = null;
    return renderTab(state.tab);
  }

  const zoomed = hit("[data-zoom]");
  if (zoomed) {
    $("#zoom-img").src = zoomed.dataset.zoom;
    $("#zoom").hidden = false;
    return;
  }

  if (hit("#zoom")) {
    $("#zoom").hidden = true;
    return;
  }

  const link = hit("[data-tg-link]");
  if (link) openLink(link, event);
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "search") return;
  state.query = event.target.value;
  renderFeed(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("#zoom").hidden) $("#zoom").hidden = true;
    else hideSheet();
  }
});

// Картинка загрузилась — плавно проявляется; не загрузилась — прячем её, под ней остаётся ровный серый фон без подписей.
document.addEventListener(
  "load",
  (event) => {
    if (event.target instanceof HTMLImageElement) markImage(event.target);
  },
  true,
);
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && img.hasAttribute("data-fallback")) {
      img.hidden = true;
      img.parentElement?.classList.add("is-ready");
    }
  },
  true,
);

// ---------- Старт ----------

// Заставка показывается один раз за сессию. Промис завершается, когда заставка уходит и можно показывать приложение.
function introGate() {
  let seen = false;
  try {
    seen = sessionStorage.getItem("introSeen") === "1";
    sessionStorage.setItem("introSeen", "1");
  } catch {
    // в приватном окне хранилища может не быть: заставка просто покажется
  }
  const frozenFrame = new URLSearchParams(location.search).has("introT");
  return new Promise((resolve) => {
    if (seen && !frozenFrame) {
      document.getElementById("intro")?.remove();
      return resolve();
    }
    playIntro({ onReveal: resolve, onPulse: haptic }).catch(() => {
      document.getElementById("intro")?.remove();
      resolve();
    });
    if (frozenFrame) resolve();
  });
}

async function start() {
  setupTelegram();
  paintTheme(currentTheme());
  track("visit");
  const revealed = introGate();
  revealed.then(() => document.documentElement.classList.remove("booting"));
  state.favorites = await loadFavorites();
  setTabbar(state.tab);
  $("#view").innerHTML = skeletonHtml();
  await renderTab(state.tab, revealed);
}

start();
