// Фото: копия из CDN Telegram хранится в базе. Если копии нет или ссылка устарела, берём свежую
// ссылку со страницы поста. Скачиваем только адреса из канала.
import { first, run } from "./db.js";
import { fetchBytes as defaultFetchBytes, fetchText as defaultFetchText, isChannelPhotoUrl } from "./fetchers.js";
import { freshPhotoUrls } from "./sync.js";

async function download(url, fetchBytes) {
  if (!url || !isChannelPhotoUrl(url)) return null;
  try {
    return await fetchBytes(url);
  } catch {
    return null;
  }
}

// Возвращает { body, content_type } или null, если фото нет или его не удалось получить.
export async function loadPhoto(db, id, { fetchBytes = defaultFetchBytes, fetchText = defaultFetchText } = {}) {
  const row = await first(db, "SELECT item_id, position, source_url, body, content_type FROM photos WHERE id = ?", [id]);
  if (!row) return null;
  if (row.body) return { body: row.body, content_type: row.content_type || "image/jpeg" };

  let file = await download(row.source_url, fetchBytes);
  if (!file) {
    // Ссылка устарела или CDN не отдал файл: берём свежую со страницы поста и пробуем ещё раз.
    const fresh = await freshPhotoUrls(db, row.item_id, fetchText);
    file = await download(fresh.get(row.position), fetchBytes);
  }
  if (!file) return null;

  await run(db, "UPDATE photos SET body = ?, content_type = ? WHERE id = ?", [file.bytes, file.contentType, id]);
  return { body: file.bytes, content_type: file.contentType };
}
