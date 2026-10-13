// Yorisell — приложение покупателя. Работает внутри Telegram и в обычном браузере (без входа).
// Данные берём с сервера (/api). Избранное — в облачном хранилище Telegram, в браузере — в памяти браузера.

const tg = window.Telegram?.WebApp;
// Telegram-скрипт загружается и в обычном браузере, поэтому проверяем, что приложение открыто внутри Telegram.
const inTelegram = Boolean(tg && tg.platform && tg.platform !== "unknown");
const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const TABS = ["favorites", "catalog", "info"];
const FAV_KEY = "favorites";
const SELLER = "https://t.me/Alexy153";
const REVIEWS = "https://www.avito.ru/brands/f9610b6b4e6fd344c27c2197bf03b0be?src=sharing";

const ICON = {
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C2B8" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C2B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>`,
  back: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.9z" fill="url(#metal)" stroke="#15161A" stroke-width="0.9" stroke-linejoin="round"/><g clip-path="url(#star-clip)"><rect class="sweep" x="-8" y="-4" width="6" height="34" fill="#FFFFFF" opacity="0.7"/></g></svg>`,
  bolt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 2L4.5 13.6h6.1L9.4 22l10.1-12h-6.2z" fill="url(#metal)" stroke="#15161A" stroke-width="0.9" stroke-linejoin="round"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H17.5A2.5 2.5 0 0 1 20 5.5V13.5A2.5 2.5 0 0 1 17.5 16H9.5L5.5 19.5V16H6.5A2.5 2.5 0 0 1 4 13.5Z" fill="url(#metal)" stroke="#15161A" stroke-width="0.9" stroke-linejoin="round"/><circle class="dot" cx="8.5" cy="9.5" r="1.3" fill="#2F3137"/><circle class="dot d2" cx="12" cy="9.5" r="1.3" fill="#2F3137"/><circle class="dot d3" cx="15.5" cy="9.5" r="1.3" fill="#2F3137"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><g class="spin"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="#15161A" stroke-width="4" stroke-linecap="round"/><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="url(#metal)" stroke-width="2.2" stroke-linecap="round"/><path d="M20 4.5V9h-4.5" fill="none" stroke="#15161A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4.5V9h-4.5" fill="none" stroke="url(#metal)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`,
};

const state = {
  tab: "catalog",
  category: "all",
  query: "",
  catalog: null,
  favorites: [],
  details: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const rub = (amount) => `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
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

// ---------- Telegram ----------

function setupTelegram() {
  if (!inTelegram) return;
  const steps = [
    () => tg.ready(),
    () => tg.expand(),
    () => tg.setHeaderColor("#2F3137"),
    () => tg.setBackgroundColor("#2F3137"),
    () => tg.setBottomBarColor?.("#2F3137"),
    () => tg.disableVerticalSwipes?.(),
    () => tg.requestFullscreen?.(),
  ];
  for (const step of steps) {
    try {
      Promise.resolve(step()).catch(() => {});
    } catch {
      /* старые версии Telegram не знают некоторых вызовов */
    }
  }
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

async function swapView(render) {
  const view = $("#view");
  view.classList.add("is-leaving");
  await pause(160);
  view.innerHTML = skeletonHtml();
  await render();
  window.scrollTo(0, 0);
  view.classList.remove("is-leaving");
}

async function switchTab(tab) {
  if (tab === state.tab) return;
  state.tab = tab;
  setTabbar(tab);
  await swapView(() => renderTab(tab));
}

async function renderTab(tab) {
  const view = $("#view");
  try {
    if (tab === "catalog") {
      if (!state.catalog) state.catalog = await api("/api/catalog");
      view.innerHTML = catalogHtml();
    } else if (tab === "favorites") {
      view.innerHTML = await favoritesHtml();
    } else {
      view.innerHTML = infoHtml();
    }
  } catch {
    view.innerHTML = `<p class="subtitle">Не удалось загрузить данные.</p>
      <button class="btn btn-ghost" type="button" data-retry style="margin-top:16px;width:100%">Повторить</button>`;
  }
}

function skeletonHtml() {
  return `<div class="skeleton" style="margin-top:24px"></div>`;
}

// ---------- Каталог ----------

function catalogHtml() {
  return `
    <header>
      <h1 class="title">Все товары</h1>
      <p class="subtitle">Только актуальное наличие</p>
    </header>
    <label class="search glass">
      ${ICON.search}
      <input id="search" type="search" placeholder="Поиск по названию" aria-label="Поиск по названию" value="${esc(state.query)}" autocomplete="off">
    </label>
    <nav class="tiles" id="tiles" aria-label="Категории">${tilesHtml()}</nav>
    <section class="grid" id="grid" aria-live="polite">${gridHtml(true)}</section>`;
}

function tilesHtml() {
  return state.catalog.categories
    .map(
      (cat) => `
      <button class="tile glass${cat.key === state.category ? " is-active" : ""}" type="button" data-cat="${esc(cat.key)}" aria-pressed="${cat.key === state.category}">
        <span class="tile-count">${cat.count}</span>
        <span>${esc(cat.title)}</span>
      </button>`,
    )
    .join("");
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  return state.catalog.items.filter(
    (item) =>
      (state.category === "all" || item.category === state.category) &&
      (!query || item.title.toLowerCase().includes(query)),
  );
}

function gridHtml(animate) {
  const items = visibleItems();
  if (items.length === 0) {
    return `<p class="subtitle" style="grid-column:1 / -1">Ничего не нашлось. Попробуйте другое название или категорию.</p>`;
  }
  return items.map((item, index) => cardHtml(item, index, animate)).join("");
}

function photoHtml(url) {
  return url
    ? `<img src="${esc(url)}" alt="" loading="lazy" data-fallback><span class="photo-label">Фото</span>`
    : `<span class="photo-label">Фото</span>`;
}

function cardHtml(item, index, animate) {
  const on = state.favorites.includes(item.id);
  const delay = animate ? `--d:${Math.min(index, 8) * 60}ms` : "animation:none";
  return `
    <article class="card glass${item.sold ? " is-sold" : ""}" style="${delay}">
      <button class="card-link" type="button" data-open="${item.id}" aria-label="${esc(item.title)}, ${rub(item.priceRub)}"></button>
      <div class="photo">
        ${photoHtml(item.coverUrl)}
        <button class="heart${on ? " is-on" : ""}" type="button" data-fav="${item.id}" aria-pressed="${on}" aria-label="В избранное">${ICON.heart}</button>
        ${item.sold ? '<span class="sold-tag">Нет в наличии</span>' : ""}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(item.title)}</div>
        <div class="card-meta">
          <span class="price">${rub(item.priceRub)}</span>
          ${item.size ? `<span class="chip">${esc(item.size)}</span>` : ""}
        </div>
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
    <header class="row-head">
      <h1 class="title">Избранное</h1>
      <span class="count-pill">${ordered.length}</span>
    </header>
    <section class="grid">${ordered.map((item, index) => cardHtml(item, index, true)).join("")}</section>`;
}

function emptyFavoritesHtml() {
  return `
    <header><h1 class="title">Избранное</h1></header>
    <section class="empty glass">
      <div class="heart-ring">${ICON.heart}</div>
      <p>Нажмите ♡ на товаре, чтобы сохранить его здесь</p>
      <button class="btn" type="button" data-goto="catalog" style="margin-top:24px;width:100%">Перейти в каталог</button>
    </section>`;
}

// ---------- Инфо ----------

function infoHtml() {
  return `
    <section class="shop-head">
      <img class="shop-logo" src="assets/logo.jpg" alt="Логотип Yorisell">
      <h1 class="shop-name">Yorisell</h1>
      <p class="shop-hours">Часы работы: 24/7</p>
    </section>

    <h2 class="section-title">Почему мы?</h2>
    <div class="why glass">
      <div class="why-item"><span class="ico ico-star">${ICON.star}</span><span>Более 150 положительных отзывов</span></div>
      <div class="why-item"><span class="ico ico-bolt">${ICON.bolt}</span><span>Отправка в день заказа</span></div>
      <div class="why-item"><span class="ico ico-chat">${ICON.chat}</span><span>Всегда на связи</span></div>
      <div class="why-item"><span class="ico ico-refresh">${ICON.refresh}</span><span>Регулярное обновление ассортимента</span></div>
    </div>

    <div class="list glass">
      <a class="list-row" href="${REVIEWS}" target="_blank" rel="noopener">
        <span><span style="font-size:15px;font-weight:600;display:block">Отзывы</span><span class="sub" style="display:block">Открыть на Avito</span></span>
        <span class="chev">${ICON.chevron}</span>
      </a>
    </div>

    <p class="section-title" style="font-size:12px;font-weight:600;color:var(--text-2);margin:24px 0 10px">Полезные ссылки</p>
    <a class="btn" href="${SELLER}" data-tg-link>Написать продавцу</a>`;
}

// ---------- Карточка товара ----------

function productHtml(item) {
  const on = state.favorites.includes(item.id);
  const gallery = item.photos.length
    ? `<div class="gallery">
         <div class="gallery-track" id="gallery">
           ${item.photos.map((url, i) => `<img src="${esc(url)}" alt="${esc(item.title)}, фото ${i + 1}" data-zoom="${esc(url)}" data-fallback>`).join("")}
         </div>
         <div class="dots" id="dots">${item.photos.map((_, i) => `<span class="dot${i === 0 ? " is-active" : ""}"></span>`).join("")}</div>
       </div>`
    : `<div class="gallery"><span class="photo-label">Фото</span></div>`;

  const measurements = item.measurements ? esc(item.measurements) : "Замеры в ЛС";
  const booking = item.sold
    ? `<span class="btn btn-ghost" aria-disabled="true">Нет в наличии</span>`
    : `<a class="btn" href="${esc(item.bookingUrl)}" data-book="${item.id}" data-tg-link>Забронировать</a>`;

  return `
    <h1 class="p-title" id="sheet-title">${esc(item.title)}</h1>
    <p class="p-sub">${item.condition ? `Состояние ${esc(item.condition)}` : ""}${item.fit ? `${item.condition ? " · " : ""}Фит ${esc(item.fit)}` : ""}</p>
    <div class="cells">
      <div class="cell glass"><span>Цена</span><span>${rub(item.priceRub)}</span></div>
      <div class="cell glass"><span>Размер</span><span>${esc(item.size ?? "—")}</span></div>
      <div class="cell glass"><span>Наличие</span><span>${item.sold ? "Нет в наличии" : "В наличии"}</span></div>
    </div>
    ${gallery}
    <section class="desc glass">
      <h2>Описание</h2>
      <p>${esc(item.description ?? "Подробности уточните в личке.")}</p>
    </section>
    <a class="spec glass" href="${SELLER}" data-tg-link><span>${measurements}</span><span aria-hidden="true">${ICON.chevron}</span></a>
    <div class="buybar">
      <button class="heart${on ? " is-on" : ""}" type="button" data-fav="${item.id}" aria-pressed="${on}" aria-label="В избранное">${ICON.heart}</button>
      ${booking}
    </div>`;
}

async function openItem(id) {
  const sheet = $("#sheet");
  const body = $("#sheet-body");
  body.innerHTML = `<div class="skeleton" style="margin-top:12px"></div>`;
  showSheet();
  track("open", id);
  try {
    const item = state.details.get(id) ?? (await api(`/api/items/${id}`));
    state.details.set(id, item);
    body.innerHTML = `<button class="back glass" type="button" data-close aria-label="Назад">${ICON.back}</button>` + productHtml(item);
    bindGallery();
  } catch {
    body.innerHTML = `<button class="back glass" type="button" data-close aria-label="Назад">${ICON.back}</button>
      <p class="subtitle" style="margin-top:72px">Этот товар сейчас недоступен.</p>`;
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
    backHandler = () => hideSheet();
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
  await pause(260);
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
    $("#view").innerHTML = await favoritesHtml();
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

  const cat = hit("[data-cat]");
  if (cat) {
    state.category = cat.dataset.cat;
    $("#tiles").innerHTML = tilesHtml();
    $("#grid").innerHTML = gridHtml(false);
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
  $("#grid").innerHTML = gridHtml(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("#zoom").hidden) $("#zoom").hidden = true;
    else hideSheet();
  }
});

// Картинки, которых ещё нет на сервере, заменяем подписью «Фото».
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
    img.hidden = true;
    const parent = img.parentElement;
    if (parent && !parent.querySelector(".photo-label")) {
      parent.insertAdjacentHTML("afterbegin", '<span class="photo-label">Фото</span>');
    }
  },
  true,
);

// ---------- Старт ----------

async function start() {
  setupTelegram();
  track("visit");
  state.favorites = await loadFavorites();
  setTabbar(state.tab);
  $("#view").innerHTML = skeletonHtml();
  await renderTab(state.tab);
}

start();
