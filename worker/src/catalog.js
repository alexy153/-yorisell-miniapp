// Чтение каталога для покупателя. Скрытые владельцем товары не выдаются.
// Проданные в каталоге не показываются, а в избранном остаются с пометкой «Нет в наличии».
import { all, first } from "./db.js";
import { buildBookingUrl } from "./booking.js";

export const CATEGORY_ORDER = ["Худи", "Свитеры", "Футболки", "Обувь", "Другое"];

const CARD_SQL = `
  SELECT i.id, i.title, i.category, i.price_rub, i.size, i.fit, i.sold_manual,
         EXISTS (SELECT 1 FROM sold_marks s WHERE s.item_id = i.id) AS sold_channel,
         COALESCE(
           (SELECT p.id FROM photos p WHERE p.item_id = i.id AND p.id = i.cover_photo_id),
           (SELECT p.id FROM photos p WHERE p.item_id = i.id ORDER BY p.position LIMIT 1)
         ) AS cover_id
  FROM items i`;

// Ручная пометка владельца важнее пометки SOLD из канала.
function isSold(row) {
  return row.sold_manual === null ? row.sold_channel === 1 : row.sold_manual === 1;
}

function toCard(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    priceRub: row.price_rub,
    size: row.size,
    fit: row.fit,
    coverUrl: row.cover_id ? `/img/${row.cover_id}` : null,
    sold: isSold(row),
  };
}

export async function getCatalog(db) {
  const rows = await all(
    db,
    `${CARD_SQL} WHERE i.visible = 1
     ORDER BY (i.sort_order IS NULL), i.sort_order, i.published_at DESC, i.id DESC`,
  );
  const cards = rows.map(toCard).filter((card) => !card.sold);

  const counts = new Map();
  for (const card of cards) counts.set(card.category, (counts.get(card.category) ?? 0) + 1);
  const categories = [
    { key: "all", title: "Все", count: cards.length },
    ...CATEGORY_ORDER.filter((key) => counts.has(key)).map((key) => ({ key, title: key, count: counts.get(key) })),
  ];
  return { categories, items: cards };
}

// Для избранного: ids — уже проверенные целые числа.
export async function getItemsByIds(db, ids) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await all(db, `${CARD_SQL} WHERE i.visible = 1 AND i.id IN (${placeholders})`, ids);
  return rows.map(toCard);
}

export async function getItemDetail(db, id) {
  const item = await first(db, "SELECT * FROM items WHERE id = ? AND visible = 1", [id]);
  if (!item) return null;

  const photos = await all(db, "SELECT id FROM photos WHERE item_id = ? ORDER BY position", [id]);
  const soldInChannel = Boolean(await first(db, "SELECT 1 AS found FROM sold_marks WHERE item_id = ?", [id]));
  const sold = item.sold_manual === null ? soldInChannel : item.sold_manual === 1;
  const cover = photos.find((photo) => photo.id === item.cover_photo_id) ?? photos[0];

  return {
    id: item.id,
    title: item.title,
    category: item.category,
    description: item.description,
    condition: item.item_condition,
    size: item.size,
    sizeNote: item.size_note,
    fit: item.fit,
    priceRub: item.price_rub,
    measurements: item.measurements,
    publishedAt: item.published_at,
    postUrl: item.post_url,
    bookingUrl: buildBookingUrl({ title: item.title, size: item.size, priceRub: item.price_rub, postId: item.id }),
    sold,
    coverUrl: cover ? `/img/${cover.id}` : null,
    photos: photos.map((photo) => `/img/${photo.id}`),
  };
}

export async function getPhoto(db, id) {
  const row = await first(db, "SELECT body, content_type FROM photos WHERE id = ?", [id]);
  return row && row.body ? row : null;
}
