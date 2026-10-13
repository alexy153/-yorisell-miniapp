// Синхронизация каталога с каналом: страницы t.me/s → товары, фото, пометки SOLD.
// Работает порциями, чтобы уложиться в лимиты бесплатного Worker (запросы и процессорное время).
import { parseChannelPage } from "./parser.js";
import { all, first, run } from "./db.js";

export const CHANNEL = "Yorisell";

// Поля, которые владелец может поправить в админке: синхронизация их не перезаписывает.
const MANUAL_FIELDS = new Set(["title", "description", "category"]);

// Категория по названию и размеру: в постах категории нет, поэтому определяем сами.
export function categoryFor({ title, sizeNote }) {
  const name = (title ?? "").toLowerCase();
  if (/худи|hoodie/.test(name)) return "Худи";
  if (/свит|sweat/.test(name)) return "Свитеры";
  if (/футболк|тишк|t-shirt/.test(name)) return "Футболки";
  if (sizeNote && /\d+,\d+\s*-\s*\d+,\d+/.test(sizeNote)) return "Обувь";
  return "Другое";
}

export function pageUrl(before) {
  return before ? `https://t.me/s/${CHANNEL}?before=${before}` : `https://t.me/s/${CHANNEL}`;
}

async function upsertItem(db, message, nowIso) {
  const category = categoryFor(message);
  const existing = await first(db, "SELECT manual_fields FROM items WHERE id = ?", [message.postId]);
  if (!existing) {
    await run(
      db,
      `INSERT INTO items (id, title, category, description, item_condition, size, size_note, fit,
                          price_rub, published_at, post_url, synced_at, manual_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
      [
        message.postId,
        message.title ?? "Без названия",
        category,
        message.description,
        message.condition,
        message.size,
        message.sizeNote,
        message.fit,
        message.priceRub,
        message.publishedAt,
        message.url,
        nowIso,
      ],
    );
    return "created";
  }

  const manual = new Set(JSON.parse(existing.manual_fields));
  const fields = {
    title: message.title ?? "Без названия",
    category,
    description: message.description,
    item_condition: message.condition,
    size: message.size,
    size_note: message.sizeNote,
    fit: message.fit,
    price_rub: message.priceRub,
    published_at: message.publishedAt,
    post_url: message.url,
    synced_at: nowIso,
  };
  const columns = Object.keys(fields).filter((name) => !(MANUAL_FIELDS.has(name) && manual.has(name)));
  await run(
    db,
    `UPDATE items SET ${columns.map((name) => `${name} = ?`).join(", ")} WHERE id = ?`,
    [...columns.map((name) => fields[name]), message.postId],
  );
  return "updated";
}

// Фото сопоставляются по позиции. Если адрес фото поменялся, скачанную копию сбрасываем.
async function syncPhotos(db, itemId, urls) {
  const rows = await all(db, "SELECT id, position, source_url FROM photos WHERE item_id = ?", [itemId]);
  for (let position = 0; position < urls.length; position++) {
    const row = rows.find((r) => r.position === position);
    if (!row) {
      await run(db, "INSERT INTO photos (item_id, position, source_url) VALUES (?, ?, ?)", [
        itemId,
        position,
        urls[position],
      ]);
    } else if (row.source_url !== urls[position]) {
      await run(db, "UPDATE photos SET source_url = ?, body = NULL, content_type = NULL WHERE id = ?", [
        urls[position],
        row.id,
      ]);
    }
  }
  await run(db, "DELETE FROM photos WHERE item_id = ? AND position >= ?", [itemId, urls.length]);
}

// Скачивает фото, которых ещё нет в базе, не больше budget штук за один запуск.
export async function cachePhotos(db, fetchBytes, budget) {
  const pending = await all(
    db,
    "SELECT id, source_url FROM photos WHERE body IS NULL ORDER BY item_id DESC, position ASC LIMIT ?",
    [budget],
  );
  let cached = 0;
  let failed = 0;
  for (const photo of pending) {
    try {
      const { bytes, contentType } = await fetchBytes(photo.source_url);
      await run(db, "UPDATE photos SET body = ?, content_type = ? WHERE id = ?", [bytes, contentType, photo.id]);
      cached++;
    } catch {
      failed++;
    }
  }
  const left = await first(db, "SELECT COUNT(*) AS n FROM photos WHERE body IS NULL");
  return { photosCached: cached, photosFailed: failed, photosPending: left.n };
}

// Применяет сообщения одной страницы. Возвращает число созданных товаров.
export async function applyMessages(db, messages, nowIso, stats) {
  let created = 0;
  for (const message of messages) {
    if (message.kind === "listing") {
      stats.listings++;
      const result = await upsertItem(db, message, nowIso);
      if (result === "created") {
        created++;
        stats.created++;
      } else {
        stats.updated++;
      }
      await syncPhotos(db, message.postId, message.photos);
    } else if (message.kind === "sold" && message.replyToPostId) {
      await run(db, "INSERT OR IGNORE INTO sold_marks (item_id, sold_post_id, seen_at) VALUES (?, ?, ?)", [
        message.replyToPostId,
        message.postId,
        nowIso,
      ]);
      stats.soldMarks++;
    }
  }
  return created;
}

export function emptyStats() {
  return { pages: 0, messages: 0, listings: 0, created: 0, updated: 0, soldMarks: 0 };
}

// Полная синхронизация с ограничением по страницам и фото.
// Новые страницы идут до первой полностью известной (кроме самой первой).
export async function syncChannel(db, { fetchText, fetchBytes, now = new Date(), pageBudget = 6, photoBudget = 25 }) {
  const nowIso = now.toISOString();
  const stats = emptyStats();
  let before = null;

  for (let page = 0; page < pageBudget; page++) {
    const messages = parseChannelPage(await fetchText(pageUrl(before)));
    stats.pages++;
    if (messages.length === 0) break;
    stats.messages += messages.length;

    const createdHere = await applyMessages(db, messages, nowIso, stats);
    const oldest = Math.min(...messages.map((m) => m.postId));
    if (before !== null && oldest >= before) break;
    if (page > 0 && createdHere === 0) break;
    before = oldest;
  }

  const photos = await cachePhotos(db, fetchBytes, photoBudget);
  const result = { at: nowIso, ...stats, ...photos };
  await run(
    db,
    "INSERT INTO sync_state (key, value) VALUES ('last_sync', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [JSON.stringify(result)],
  );
  return result;
}

// Обновляет один товар: читает страницу, где есть его пост, и применяет только его.
export async function refreshItem(db, { itemId, fetchText, now = new Date() }) {
  const nowIso = now.toISOString();
  const messages = parseChannelPage(await fetchText(pageUrl(itemId + 1)));
  const own = messages.filter((m) => m.postId === itemId && m.kind === "listing");
  if (own.length === 0) return { found: false };
  const stats = emptyStats();
  await applyMessages(db, own, nowIso, stats);
  return { found: true, ...stats };
}

export async function lastSync(db) {
  const row = await first(db, "SELECT value FROM sync_state WHERE key = 'last_sync'");
  return row ? JSON.parse(row.value) : null;
}
