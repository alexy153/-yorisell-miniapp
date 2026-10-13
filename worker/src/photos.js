// Фото: копия из CDN Telegram сохраняется в базе при первом показе, дальше отдаётся из базы.
// Скачиваем только ссылки, которые пришли из канала: адрес в базе не должен вести куда угодно.
import { first, run } from "./db.js";
import { fetchBytes as defaultFetchBytes } from "./fetchers.js";

export function isChannelPhotoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && (url.hostname === "telesco.pe" || url.hostname.endsWith(".telesco.pe"));
}

// Возвращает { body, content_type } или null, если фото нет или его не удалось получить.
export async function loadPhoto(db, id, fetchBytes = defaultFetchBytes) {
  const row = await first(db, "SELECT source_url, body, content_type FROM photos WHERE id = ?", [id]);
  if (!row) return null;
  if (row.body) return { body: row.body, content_type: row.content_type || "image/jpeg" };
  if (!isChannelPhotoUrl(row.source_url)) return null;

  const { bytes, contentType } = await fetchBytes(row.source_url);
  await run(db, "UPDATE photos SET body = ?, content_type = ? WHERE id = ?", [bytes, contentType, id]);
  return { body: bytes, content_type: contentType };
}
