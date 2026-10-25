// Админ-панель: товары и статистика. Все данные приходят с сервера, и каждый запрос подписан Telegram.
// Браузеру не доверяем: сервер сам проверяет подпись токеном бота и сравнивает ID с владельцем.
const tg = window.Telegram?.WebApp;
const initData = tg?.initData ?? "";

const CATEGORIES = ["Джинсы", "Худи", "Свитеры", "Футболки", "Обувь", "Другое"];
const PERIODS = [
  { days: 1, label: "Сегодня" },
  { days: 7, label: "7 дней" },
  { days: 0, label: "Всё" },
];
const SVG = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON = {
  pencil: `<svg ${SVG}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  refresh: `<svg ${SVG}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>`,
  up: `<svg ${SVG}><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`,
  down: `<svg ${SVG}><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>`,
};

const state = {
  view: "items",
  items: [],
  lastSync: null,
  days: 7,
  stats: null,
  syncing: false,
  moving: false,
  draft: null,
};

const app = document.querySelector("#admin");
const sheet = document.querySelector("#sheet");
const toastEl = document.querySelector("#toast");

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { Authorization: `tma ${initData}` };
  const init = { method, headers, cache: "no-store" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? "Ошибка сервера");
  return data;
}

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const num = (value) => Number(value).toLocaleString("ru-RU");
const rub = (value) => `${num(value)} ₽`;
const findItem = (id) => state.items.find((item) => item.id === id);

let toastTimer = 0;
function notify(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
}

function gate(title, text) {
  app.innerHTML = `<section class="gate glass"><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`;
}

function render() {
  app.innerHTML = `${header()}${state.view === "items" ? itemsView() : statsView()}`;
}

function header() {
  const onItems = state.view === "items";
  const syncButton = onItems
    ? `<button class="btn btn-light" type="button" data-action="sync" ${state.syncing ? "disabled" : ""}>${
        state.syncing ? "Обновляем…" : "Обновить каталог"
      }</button>`
    : "";
  return `
    <header class="admin-head">
      <div>
        <p class="admin-caption">Админ-панель</p>
        <h1 class="admin-title">${onItems ? "Товары" : "Статистика"}</h1>
        ${onItems ? `<p class="admin-sub">Авто-обновление каждые 30 минут</p>${syncNote(state.lastSync)}` : ""}
      </div>
      ${syncButton}
    </header>
    <div class="seg glass" role="group" aria-label="Раздел">
      <button type="button" data-action="view" data-view="items" aria-pressed="${onItems}">Товары</button>
      <button type="button" data-action="view" data-view="stats" aria-pressed="${!onItems}">Статистика</button>
    </div>`;
}

function syncNote(sync) {
  if (!sync) return `<p class="admin-note">Каталог ещё не загружался. Нажмите «Обновить каталог».</p>`;
  if (sync.stopped === "error") return `<p class="admin-note">Последнее обновление не удалось: канал не ответил.</p>`;
  const when = new Date(sync.at).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const archive = sync.archiveDone ? "" : " Архив догружается: нажмите «Обновить каталог» ещё раз.";
  return `<p class="admin-note">Последнее обновление: ${esc(when)}.${archive}</p>`;
}

function itemsView() {
  if (state.items.length === 0) {
    return `<p class="empty glass">Товаров пока нет. Нажмите «Обновить каталог», и они появятся из канала.</p>`;
  }
  const last = state.items.length - 1;
  return `<ol class="items">${state.items.map((item, index) => itemCard(item, index, last)).join("")}</ol>`;
}

function itemCard(item, index, last) {
  const notes = [item.soldManual === null ? null : "вручную", item.visible ? null : "скрыт"].filter(Boolean);
  // Неразрывный пробел в «В наличии»: иначе фраза переносится на две строки в узкой колонке.
  const status = [item.size ?? "—", rub(item.priceRub), item.soldEffective ? "Продано" : "В наличии", ...notes];
  const cover = item.coverPhotoId ?? item.photoIds[0];
  const image = cover
    ? `<img class="item-cover" src="${mediaSrc(item, cover)}" alt="" loading="lazy">`
    : `<div class="item-cover" aria-hidden="true"></div>`;
  return `
    <li class="item glass">
      <div class="item-main">
        ${image}
        <div>
          <h2 class="item-title">${esc(item.title)}</h2>
          <p class="item-meta">${esc(status.join(" · "))}</p>
        </div>
        <button class="switch" type="button" role="switch" aria-checked="${item.visible}"
                aria-label="Показывать в каталоге" data-action="toggle" data-id="${item.id}"></button>
      </div>
      <div class="item-actions">
        <button class="chip" type="button" data-action="edit" data-id="${item.id}">${ICON.pencil}<span>Изменить</span></button>
        <button class="chip" type="button" data-action="refresh" data-id="${item.id}">${ICON.refresh}<span>Обновить</span></button>
        <button class="chip chip-icon" type="button" data-action="move" data-id="${item.id}" data-dir="-1"
                aria-label="Поднять выше" ${index === 0 ? "disabled" : ""}>${ICON.up}</button>
        <button class="chip chip-icon" type="button" data-action="move" data-id="${item.id}" data-dir="1"
                aria-label="Опустить ниже" ${index === last ? "disabled" : ""}>${ICON.down}</button>
      </div>
    </li>`;
}

function statsView() {
  const periods = `<div class="period" role="group" aria-label="Период">${PERIODS.map(
    (period) =>
      `<button class="pill" type="button" data-action="period" data-days="${period.days}" aria-pressed="${
        state.days === period.days
      }">${period.label}</button>`,
  ).join("")}</div>`;
  if (!state.stats) return `${periods}<p class="empty glass">Загрузка…</p>`;

  const { totals, items } = state.stats;
  const names = new Map(state.items.map((item) => [item.id, item.title]));
  const rows = items
    .slice(0, 10)
    .map(
      (row) =>
        `<div class="top-row"><span class="top-name">${esc(names.get(row.id) ?? `Товар №${row.id}`)}</span>` +
        `<span class="top-nums">${num(row.opens)} / ${num(row.books)} / ${num(row.favorites)}</span></div>`,
    );
  return `
    ${periods}
    <div class="tiles">
      ${tile("Визиты", totals.visits)}
      ${tile("Открытия карточек", totals.opens)}
      ${tile("Нажатия «Забронировать»", totals.books)}
      ${tile("Нажатия ♡", totals.favorites)}
    </div>
    <div class="top-head"><b>Топ товаров</b><span>открытия / брони / ♡</span></div>
    <div class="top glass">${rows.length ? rows.join("") : `<div class="top-row"><span class="top-name">За этот период открытий пока нет.</span></div>`}</div>`;
}

const tile = (label, value) =>
  `<div class="tile glass"><span class="tile-label">${label}</span><span class="tile-value">${num(value)}</span></div>`;

// Правка товара: в окне только поля, которые реально изменились, уходят на сервер.
function openSheet(item) {
  state.draft = { id: item.id, soldManual: item.soldManual, coverPhotoId: item.coverPhotoId };
  const statuses = [
    { value: "null", label: "Как в канале" },
    { value: "false", label: "В наличии" },
    { value: "true", label: "Продано" },
  ];
  const covers = [null, ...item.photoIds].map((photoId) => coverButton(photoId, item));
  sheet.innerHTML = `
    <form class="sheet glass" role="dialog" aria-modal="true" aria-labelledby="sheet-title" novalidate>
      <h2 id="sheet-title" class="sheet-title">Изменить товар</h2>
      <label class="field"><span>Название</span>
        <input name="title" maxlength="200" value="${esc(item.title)}"></label>
      <label class="field"><span>Описание</span>
        <textarea name="description" maxlength="4000">${esc(item.description ?? "")}</textarea></label>
      <label class="field"><span>Категория</span>
        <select name="category">${CATEGORIES.map(
          (category) => `<option${category === item.category ? " selected" : ""}>${esc(category)}</option>`,
        ).join("")}</select></label>
      <label class="field"><span>Замеры (пусто — «Замеры в ЛС»)</span>
        <input name="measurements" maxlength="500" value="${esc(item.measurements ?? "")}"></label>
      <div class="field"><span>Статус</span>
        <div class="seg" role="group" aria-label="Статус">${statuses
          .map(
            (status) =>
              `<button type="button" data-action="status" data-value="${status.value}" aria-pressed="${
                String(state.draft.soldManual) === status.value
              }">${status.label}</button>`,
          )
          .join("")}</div>
      </div>
      <div class="field"><span>Обложка</span>
        <div class="covers" role="group" aria-label="Обложка">${covers.join("")}</div>
      </div>
      <div class="sheet-actions">
        <button class="btn" type="button" data-action="cancel">Отмена</button>
        <button class="btn btn-light" type="submit">Сохранить</button>
      </div>
    </form>`;
  sheet.hidden = false;
}

// Маленькая версия фото по его месту в альбоме товара (тот же порядок, что в витрине).
function mediaSrc(item, photoId) {
  const index = Math.max(0, item.photoIds.indexOf(photoId));
  return item.media[index]?.small ?? "";
}

function coverButton(photoId, item) {
  if (photoId === null) {
    const first = item.photoIds[0];
    const picture = first ? `<img src="${mediaSrc(item, first)}" alt="">` : "";
    return `<button type="button" data-action="cover" data-value="auto" aria-label="Первое фото"
              aria-pressed="${state.draft.coverPhotoId === null}">${picture}<span class="auto-label">Первое фото</span></button>`;
  }
  return `<button type="button" data-action="cover" data-value="${photoId}" aria-label="Фото"
            aria-pressed="${state.draft.coverPhotoId === photoId}"><img src="${mediaSrc(item, photoId)}" alt=""></button>`;
}

function closeSheet() {
  sheet.hidden = true;
  sheet.innerHTML = "";
  state.draft = null;
}

async function saveDraft() {
  const item = findItem(state.draft.id);
  if (!item) return closeSheet();
  const form = new FormData(sheet.querySelector("form"));
  const text = (name) => String(form.get(name) ?? "").trim();
  const changes = {};
  if (text("title") !== item.title) changes.title = text("title");
  if (text("description") !== (item.description ?? "")) changes.description = text("description");
  if (form.get("category") !== item.category) changes.category = form.get("category");
  if (text("measurements") !== (item.measurements ?? "")) changes.measurements = text("measurements");
  if (state.draft.soldManual !== item.soldManual) changes.soldManual = state.draft.soldManual;
  if (state.draft.coverPhotoId !== item.coverPhotoId) changes.coverPhotoId = state.draft.coverPhotoId;
  if (Object.keys(changes).length === 0) return closeSheet();

  try {
    await api(`/api/admin/items/${item.id}`, { method: "PATCH", body: changes });
    closeSheet();
    notify("Сохранено");
    await loadItems();
  } catch (error) {
    notify(error.message);
  }
}

// Порядок меняем целиком: сервер получает весь список и записывает его одним запросом.
async function move(id, dir) {
  if (state.moving) return;
  const index = state.items.findIndex((item) => item.id === id);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= state.items.length) return;

  const previous = state.items;
  const next = [...previous];
  [next[index], next[target]] = [next[target], next[index]];
  state.items = next;
  state.moving = true;
  render();
  try {
    await api("/api/admin/order", { method: "PUT", body: { ids: next.map((item) => item.id) } });
  } catch (error) {
    notify(error.message);
    state.items = previous;
    await loadItems().catch(() => {});
  } finally {
    state.moving = false;
    render();
  }
}

async function toggleVisible(id) {
  const item = findItem(id);
  if (!item) return;
  try {
    await api(`/api/admin/items/${id}`, { method: "PATCH", body: { visible: !item.visible } });
    notify(item.visible ? "Товар скрыт из каталога." : "Товар показан в каталоге.");
    await loadItems();
  } catch (error) {
    notify(error.message);
  }
}

async function refreshItem(id) {
  try {
    const result = await api(`/api/admin/items/${id}/refresh`, { method: "POST" });
    notify(result.updated > 0 ? "Товар обновлён из канала." : "В канале изменений нет.");
    await loadItems();
  } catch (error) {
    notify(error.message);
  }
}

async function syncCatalog() {
  if (state.syncing) return;
  state.syncing = true;
  render();
  try {
    const result = await api("/api/admin/sync", { method: "POST" });
    notify(syncSummary(result));
    await loadItems();
  } catch (error) {
    notify(error.message);
  } finally {
    state.syncing = false;
    render();
  }
}

function syncSummary(result) {
  if (result.stopped === "error") return `Канал не ответил: ${result.error ?? "попробуйте позже"}.`;
  const parts = [`новых: ${result.created}`, `обновлено: ${result.updated}`];
  if (!result.archiveDone) parts.push("архив догружается, нажмите ещё раз");
  return `Каталог обновлён. ${parts.join(", ")}.`;
}

async function loadItems() {
  const data = await api("/api/admin/items");
  state.items = data.items;
  state.lastSync = data.lastSync;
  render();
}

async function loadStats() {
  state.stats = null;
  render();
  try {
    state.stats = await api(`/api/admin/stats?days=${state.days}`);
  } catch (error) {
    notify(error.message);
  }
  render();
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const id = Number(button.dataset.id);
  switch (button.dataset.action) {
    case "view":
      state.view = button.dataset.view;
      render();
      if (state.view === "stats") loadStats();
      break;
    case "sync":
      syncCatalog();
      break;
    case "toggle":
      toggleVisible(id);
      break;
    case "edit": {
      const item = findItem(id);
      if (item) openSheet(item);
      break;
    }
    case "refresh":
      refreshItem(id);
      break;
    case "move":
      move(id, Number(button.dataset.dir));
      break;
    case "period":
      state.days = Number(button.dataset.days);
      loadStats();
      break;
  }
});

sheet.addEventListener("click", (event) => {
  if (event.target === sheet) return closeSheet(); // нажали мимо окна
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, value } = button.dataset;
  if (action === "cancel") closeSheet();
  if (action === "status") {
    state.draft.soldManual = value === "null" ? null : value === "true";
    for (const option of sheet.querySelectorAll('[data-action="status"]')) {
      option.setAttribute("aria-pressed", String(option === button));
    }
  }
  if (action === "cover") {
    state.draft.coverPhotoId = value === "auto" ? null : Number(value);
    for (const option of sheet.querySelectorAll('[data-action="cover"]')) {
      option.setAttribute("aria-pressed", String(option === button));
    }
  }
});

sheet.addEventListener("submit", (event) => {
  event.preventDefault();
  saveDraft();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sheet.hidden) closeSheet();
});

async function start() {
  tg?.ready?.();
  tg?.expand?.();
  if (!initData) {
    gate("Откройте админку в Telegram", "Эта страница работает только внутри Telegram и только для владельца магазина.");
    return;
  }
  try {
    await loadItems();
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      gate(
        "Нет доступа",
        "Откройте админку из бота под аккаунтом владельца. Если сессия устарела, закройте приложение и откройте его снова.",
      );
    } else {
      gate("Не получилось загрузить", error.message);
    }
  }
}

start();
