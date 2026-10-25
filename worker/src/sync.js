// Синхронизация каталога с каналом: страницы t.me/s → товары, фото и пометки SOLD.
// Бесплатный Worker разрешает до 50 обращений к базе и к сети на один запуск, поэтому каждый запуск
// укладывается в бюджет. Что уже записано, второй раз не пишем: повторный запуск без изменений
// только читает. Архив старых постов идёт порциями: курсор сохраняется, и следующий запуск
// (расписание или кнопка в админке) продолжает с того же места.
// Фото копируем в базу, пока ссылки Telegram свежие: со временем они перестают работать.
import { parseChannelPage } from "./parser.js";
import { all, first, run } from "./db.js";
import { fetchBytes as defaultFetchBytes, isChannelPhotoUrl } from "./fetchers.js";

export const CHANNEL = "Yorisell";
// Запас до лимита 50: на итоговые записи и на непредвиденные обращения.
export const DEFAULT_BUDGET = 40;

// Поля, которые владелец может поправить в админке: синхронизация их не перезаписывает.
const MANUAL_FIELDS = new Set(["title", "description", "category"]);
// Поля товара из канала. Порядок совпадает с INSERT в applyListing.
const FIELDS = [
  "title",
  "category",
  "description",
  "item_condition",
  "size",
  "size_note",
  "fit",
  "price_rub",
  "published_at",
  "post_url",
];
// Итоговые записи (курсор и отчёт) резервируем: их нужно сохранить, даже если бюджет почти исчерпан.
const FINAL_WRITES = 2;
// У D1 есть лимит параметров в одном запросе: по 3 параметра на фото, не больше 30 фото за раз.
const PHOTO_ROWS_PER_INSERT = 30;
const UPSERT_STATE =
  "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value";

export class BudgetExhausted extends Error {
  constructor() {
    super("бюджет обращений исчерпан");
    this.name = "BudgetExhausted";
  }
}

// Категория по названию и размеру: в постах категории нет, поэтому определяем сами.
export function categoryFor({ title, sizeNote }) {
  const name = (title ?? "").toLowerCase();
  if (/джинс|jeans|denim/.test(name)) return "Джинсы";
  if (/худи|hoodie/.test(name)) return "Худи";
  if (/свит|sweat/.test(name)) return "Свитеры";
  if (/футболк|тишк|t-shirt/.test(name)) return "Футболки";
  if (sizeNote && /\d+,\d+\s*-\s*\d+,\d+/.test(sizeNote)) return "Обувь";
  return "Другое";
}

export function pageUrl(before) {
  return before ? `https://t.me/s/${CHANNEL}?before=${before}` : `https://t.me/s/${CHANNEL}`;
}

// Каждое обращение к базе и к сети — одна единица бюджета.
function createMeter(db, budget) {
  const meter = {
    left: budget,
    spent: 0,
    reserve: FINAL_WRITES,
    spend() {
      if (meter.left - meter.reserve < 1) throw new BudgetExhausted();
      meter.left -= 1;
      meter.spent += 1;
    },
    // Можно ли ещё потратить count обращений, не трогая резерв на итоговые записи.
    canSpend(count) {
      return meter.left - meter.reserve >= count;
    },
    all(sql, params = []) {
      meter.spend();
      return all(db, sql, params);
    },
    first(sql, params = []) {
      meter.spend();
      return first(db, sql, params);
    },
    run(sql, params = []) {
      meter.spend();
      return run(db, sql, params);
    },
    fetch(fetchFn, url) {
      meter.spend();
      return fetchFn(url);
    },
  };
  return meter;
}

function emptyReport(at) {
  return {
    at,
    pages: 0,
    messages: 0,
    listings: 0,
    created: 0,
    updated: 0,
    soldMarks: 0,
    photosSaved: 0,
    archiveDone: false,
    stopped: null,
    error: null,
    used: 0,
  };
}

// Всё, что уже есть в базе, читаем разом: дальше сравниваем в памяти и пишем только изменения.
async function loadState(meter, fetchBytes) {
  const items = new Map();
  const rows = await meter.all(
    `SELECT id, title, category, description, item_condition, size, size_note, fit, price_rub,
            published_at, post_url, manual_fields
     FROM items`,
  );
  for (const row of rows) items.set(row.id, { ...row, manual: new Set(JSON.parse(row.manual_fields)) });

  const photos = new Map();
  for (const row of await meter.all("SELECT item_id, COUNT(*) AS n FROM photos GROUP BY item_id")) {
    photos.set(row.item_id, row.n);
  }
  // Фото без сохранённой копии: их нужно догрузить, пока есть свежая ссылка.
  const missing = new Map();
  for (const row of await meter.all("SELECT item_id, position FROM photos WHERE body IS NULL")) {
    if (!missing.has(row.item_id)) missing.set(row.item_id, new Set());
    missing.get(row.item_id).add(row.position);
  }
  const sold = new Set((await meter.all("SELECT item_id FROM sold_marks")).map((row) => row.item_id));
  return { items, photos, missing, sold, fetchBytes };
}

async function loadArchive(meter) {
  const row = await meter.first("SELECT value FROM sync_state WHERE key = 'archive'");
  return row ? JSON.parse(row.value) : { next: null, done: false };
}

function fieldsFor(message) {
  return {
    title: message.title ?? "Без названия",
    category: categoryFor(message),
    description: message.description ?? null,
    item_condition: message.condition ?? null,
    size: message.size ?? null,
    size_note: message.sizeNote ?? null,
    fit: message.fit ?? null,
    price_rub: message.priceRub ?? null,
    published_at: message.publishedAt ?? null,
    post_url: message.url ?? null,
  };
}

// Новый товар вставляем. Известный — обновляем только изменившиеся поля, которые владелец не правил.
async function applyListing(meter, state, message, nowIso, report) {
  const fields = fieldsFor(message);
  const row = state.items.get(message.postId);
  if (!row) {
    await meter.run(
      `INSERT INTO items (id, title, category, description, item_condition, size, size_note, fit,
                          price_rub, published_at, post_url, synced_at, manual_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
      [message.postId, ...FIELDS.map((name) => fields[name]), nowIso],
    );
    state.items.set(message.postId, { ...fields, id: message.postId, manual: new Set() });
    report.created++;
  } else {
    const changed = FIELDS.filter(
      (name) => !(MANUAL_FIELDS.has(name) && row.manual.has(name)) && (row[name] ?? null) !== fields[name],
    );
    if (changed.length > 0) {
      await meter.run(
        `UPDATE items SET ${changed.map((name) => `${name} = ?`).join(", ")}, synced_at = ? WHERE id = ?`,
        [...changed.map((name) => fields[name]), nowIso, message.postId],
      );
      for (const name of changed) row[name] = fields[name];
      report.updated++;
    }
  }
  const urls = message.photos ?? [];
  await syncPhotos(meter, state, message.postId, urls);
  await warmPhotos(meter, state, message.postId, urls, report);
  report.listings++;
}

function missingSet(state, itemId) {
  if (!state.missing.has(itemId)) state.missing.set(itemId, new Set());
  return state.missing.get(itemId);
}

// Фото сверяем по количеству позиций: недостающие добавляем, лишние убираем.
// Уже сохранённые копии не трогаем.
async function syncPhotos(meter, state, itemId, urls) {
  const stored = state.photos.get(itemId) ?? 0;
  const missing = missingSet(state, itemId);
  if (stored < urls.length) {
    const added = urls.slice(stored);
    for (let offset = 0; offset < added.length; offset += PHOTO_ROWS_PER_INSERT) {
      const chunk = added.slice(offset, offset + PHOTO_ROWS_PER_INSERT);
      const params = chunk.flatMap((url, index) => [itemId, stored + offset + index, url]);
      await meter.run(
        `INSERT OR IGNORE INTO photos (item_id, position, source_url) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`,
        params,
      );
    }
    for (let position = stored; position < urls.length; position++) missing.add(position);
    state.photos.set(itemId, urls.length);
  } else if (stored > urls.length) {
    await meter.run("DELETE FROM photos WHERE item_id = ? AND position >= ?", [itemId, urls.length]);
    for (const position of [...missing]) if (position >= urls.length) missing.delete(position);
    state.photos.set(itemId, urls.length);
  }
}

// Копируем в базу фото без сохранённой копии, пока ссылки на странице свежие.
// Одна копия — два обращения: скачать и записать. Если бюджета не хватает, догрузим в следующем запуске.
async function warmPhotos(meter, state, itemId, urls, report) {
  const missing = state.missing.get(itemId);
  if (!missing || missing.size === 0) return;
  for (const position of [...missing].sort((a, b) => a - b)) {
    const url = urls[position];
    if (!url || !isChannelPhotoUrl(url)) continue;
    if (!meter.canSpend(2)) return;
    let file;
    try {
      file = await meter.fetch(state.fetchBytes, url);
    } catch {
      continue; // ссылка не открылась: попробуем в другой раз
    }
    await meter.run("UPDATE photos SET source_url = ?, body = ?, content_type = ? WHERE item_id = ? AND position = ?", [
      url,
      file.bytes,
      file.contentType,
      itemId,
      position,
    ]);
    missing.delete(position);
    report.photosSaved++;
  }
}

// Фото, которые не удалось сохранить раньше (не хватило бюджета), догружаем со страницы поста:
// там ссылки свежие. Новые посты идут первыми, пока есть бюджет.
async function warmBacklog(meter, state, fetchText, report) {
  const ids = [...state.missing]
    .filter(([, positions]) => positions.size > 0)
    .map(([itemId]) => itemId)
    .sort((a, b) => b - a);
  for (const itemId of ids) {
    if (!meter.canSpend(3)) return;
    try {
      const messages = parseChannelPage(await meter.fetch(fetchText, pageUrl(itemId + 1)));
      const post = messages.find((message) => message.postId === itemId && message.kind === "listing");
      if (post) await warmPhotos(meter, state, itemId, post.photos ?? [], report);
    } catch {
      // страница не открылась: попробуем в следующем запуске
    }
  }
}

// Пост SOLD ссылается на товар. Пометку сохраняем, даже если товар ещё не попал в базу:
// когда он придёт из архива, пометка уже будет на месте.
async function applySold(meter, state, message, nowIso, report) {
  const itemId = message.replyToPostId;
  if (state.sold.has(itemId)) return;
  await meter.run("INSERT OR IGNORE INTO sold_marks (item_id, sold_post_id, seen_at) VALUES (?, ?, ?)", [
    itemId,
    message.postId,
    nowIso,
  ]);
  state.sold.add(itemId);
  report.soldMarks++;
}

// Сначала товары, потом пометки: порядок постов внутри страницы не важен.
async function applyPage(meter, state, messages, nowIso, report) {
  for (const message of messages) {
    if (message.kind === "listing") await applyListing(meter, state, message, nowIso, report);
  }
  for (const message of messages) {
    if (message.kind === "sold" && message.replyToPostId) await applySold(meter, state, message, nowIso, report);
  }
}

async function readPage(meter, fetchText, before, report) {
  const messages = parseChannelPage(await meter.fetch(fetchText, pageUrl(before)));
  report.pages++;
  report.messages += messages.length;
  return messages;
}

// Первая страница — самые новые посты. Её читаем на каждом запуске.
async function syncLatest(meter, state, fetchText, nowIso, report, archive) {
  const messages = await readPage(meter, fetchText, null, report);
  await applyPage(meter, state, messages, nowIso, report);
  if (archive.next === null && !archive.done) {
    if (messages.length === 0) archive.done = true;
    else archive.next = Math.min(...messages.map((message) => message.postId));
  }
}

// Архив: страницы назад от курсора. Курсор двигаем только после полностью обработанной страницы.
// Если бюджет кончился посередине, при следующем запуске страница читается заново, а уже
// записанное не пишется повторно (сравнение в памяти).
async function syncArchive(meter, state, fetchText, nowIso, report, archive) {
  while (!archive.done) {
    const messages = await readPage(meter, fetchText, archive.next, report);
    if (messages.length === 0) {
      archive.done = true;
      return;
    }
    const oldest = Math.min(...messages.map((message) => message.postId));
    if (oldest >= archive.next) {
      // Страница не ушла назад: останавливаемся, иначе запуски будут ходить по кругу.
      archive.done = true;
      return;
    }
    await applyPage(meter, state, messages, nowIso, report);
    archive.next = oldest;
  }
}

// Полная синхронизация в пределах бюджета. Ошибка сети или исчерпанный бюджет не роняют запуск:
// в отчёте видно, на чём остановились, и следующий запуск продолжит оттуда же.
export async function syncChannel(
  db,
  { fetchText, fetchBytes = defaultFetchBytes, now = new Date(), budget = DEFAULT_BUDGET },
) {
  const nowIso = now.toISOString();
  const meter = createMeter(db, budget);
  const report = emptyReport(nowIso);
  const archive = { next: null, done: false };
  let archiveBefore = null;

  try {
    const state = await loadState(meter, fetchBytes);
    Object.assign(archive, await loadArchive(meter));
    archiveBefore = JSON.stringify(archive);
    await syncLatest(meter, state, fetchText, nowIso, report, archive);
    await syncArchive(meter, state, fetchText, nowIso, report, archive);
    await warmBacklog(meter, state, fetchText, report);
  } catch (error) {
    report.stopped = error instanceof BudgetExhausted ? "budget" : "error";
    if (report.stopped === "error") report.error = String(error?.message ?? error);
  }

  // Итоги сохраняем всегда: для этого зарезервированы последние обращения.
  meter.reserve = 0;
  try {
    report.archiveDone = archive.done;
    if (archiveBefore !== null && JSON.stringify(archive) !== archiveBefore) {
      await meter.run(UPSERT_STATE, ["archive", JSON.stringify(archive)]);
    }
    report.used = meter.spent; // обращения за запуск, не считая записи самого отчёта
    await meter.run(UPSERT_STATE, ["last_sync", JSON.stringify(report)]);
  } catch (error) {
    report.stopped ??= error instanceof BudgetExhausted ? "budget" : "error";
  }
  return report;
}

// Обновляет один товар: читает страницу, где есть его пост, и применяет только его.
export async function refreshItem(
  db,
  { itemId, fetchText, fetchBytes = defaultFetchBytes, now = new Date(), budget = DEFAULT_BUDGET },
) {
  const nowIso = now.toISOString();
  const meter = createMeter(db, budget);
  const messages = parseChannelPage(await meter.fetch(fetchText, pageUrl(itemId + 1)));
  const own = messages.filter((message) => message.postId === itemId && message.kind === "listing");
  if (own.length === 0) return { found: false };
  const state = await loadState(meter, fetchBytes);
  const report = emptyReport(nowIso);
  await applyPage(meter, state, own, nowIso, report);
  return { found: true, created: report.created, updated: report.updated, listings: report.listings };
}

// Ссылки Telegram временные. Свежие ссылки берём со страницы поста и запоминаем по позициям.
export async function freshPhotoUrls(db, itemId, fetchText) {
  const messages = parseChannelPage(await fetchText(pageUrl(itemId + 1)));
  const post = messages.find((message) => message.postId === itemId && message.kind === "listing");
  const fresh = new Map();
  (post?.photos ?? []).forEach((url, position) => fresh.set(position, url));
  for (const [position, url] of fresh) {
    await run(db, "UPDATE photos SET source_url = ? WHERE item_id = ? AND position = ?", [url, itemId, position]);
  }
  return fresh;
}

export async function lastSync(db) {
  const row = await first(db, "SELECT value FROM sync_state WHERE key = 'last_sync'");
  return row ? JSON.parse(row.value) : null;
}
