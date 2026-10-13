// Админ-функции. Вызываются только после проверки подписи (см. router.js и auth.js).
import { all, first, run } from "./db.js";
import { CATEGORY_ORDER } from "./catalog.js";
import { refreshItem, syncChannel, lastSync } from "./sync.js";
import { fetchText as defaultFetchText, fetchBytes as defaultFetchBytes } from "./fetchers.js";

// Поля, которые владелец правит вручную: синхронизация их потом не перезаписывает.
const MANUAL = new Set(["title", "description", "category"]);
const TEXT_LIMITS = { title: 200, description: 4000, measurements: 500 };

export async function listAdminItems(db) {
  const rows = await all(
    db,
    `SELECT i.*,
       EXISTS (SELECT 1 FROM sold_marks s WHERE s.item_id = i.id) AS sold_channel,
       (SELECT COUNT(*) FROM photos p WHERE p.item_id = i.id) AS photo_count,
       (SELECT COUNT(*) FROM photos p WHERE p.item_id = i.id AND p.body IS NOT NULL) AS cached_count
     FROM items i
     ORDER BY (i.sort_order IS NULL), i.sort_order, i.published_at DESC, i.id DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    measurements: row.measurements,
    priceRub: row.price_rub,
    size: row.size,
    fit: row.fit,
    publishedAt: row.published_at,
    postUrl: row.post_url,
    visible: row.visible === 1,
    soldManual: row.sold_manual === null ? null : row.sold_manual === 1,
    soldChannel: row.sold_channel === 1,
    soldEffective: row.sold_manual === null ? row.sold_channel === 1 : row.sold_manual === 1,
    sortOrder: row.sort_order,
    coverPhotoId: row.cover_photo_id,
    photoCount: row.photo_count,
    cachedCount: row.cached_count,
    manualFields: JSON.parse(row.manual_fields),
  }));
}

// Возвращает { status, ok? , error? }. Проверяет каждое поле, прежде чем менять базу.
export async function patchItem(db, id, body) {
  const item = await first(db, "SELECT id, manual_fields FROM items WHERE id = ?", [id]);
  if (!item) return { status: 404, error: "товар не найден" };
  const fail = (error) => ({ status: 400, error });

  const sets = [];
  const params = [];
  const manual = new Set(JSON.parse(item.manual_fields));

  if ("visible" in body) {
    if (typeof body.visible !== "boolean") return fail("visible: нужно true или false");
    sets.push("visible = ?");
    params.push(body.visible ? 1 : 0);
  }

  if ("soldManual" in body) {
    const value = body.soldManual;
    if (value !== null && typeof value !== "boolean") return fail("soldManual: true, false или null");
    sets.push("sold_manual = ?");
    params.push(value === null ? null : value ? 1 : 0);
  }

  for (const field of ["title", "description", "measurements"]) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null && field !== "title") {
      sets.push(`${field} = ?`);
      params.push(null);
    } else if (typeof value === "string" && value.length <= TEXT_LIMITS[field]) {
      const text = value.trim();
      if (field === "title" && text === "") return fail("title: название не может быть пустым");
      sets.push(`${field} = ?`);
      params.push(text === "" ? null : text);
    } else {
      return fail(`${field}: некорректное значение`);
    }
    if (MANUAL.has(field)) manual.add(field);
  }

  if ("category" in body) {
    if (typeof body.category !== "string" || !CATEGORY_ORDER.includes(body.category)) {
      return fail("category: одна из категорий каталога");
    }
    sets.push("category = ?");
    params.push(body.category);
    manual.add("category");
  }

  if ("coverPhotoId" in body) {
    const value = body.coverPhotoId;
    if (value !== null) {
      if (!Number.isInteger(value)) return fail("coverPhotoId: число или null");
      const photo = await first(db, "SELECT id FROM photos WHERE id = ? AND item_id = ?", [value, id]);
      if (!photo) return fail("coverPhotoId: фото не принадлежит этому товару");
    }
    sets.push("cover_photo_id = ?");
    params.push(value);
  }

  if ("sortOrder" in body) {
    const value = body.sortOrder;
    if (value !== null && !Number.isInteger(value)) return fail("sortOrder: целое число или null");
    sets.push("sort_order = ?");
    params.push(value);
  }

  if (sets.length === 0) return fail("нет полей для изменения");

  sets.push("manual_fields = ?");
  params.push(JSON.stringify([...manual].filter((name) => MANUAL.has(name)).sort()));
  params.push(id);
  await run(db, `UPDATE items SET ${sets.join(", ")} WHERE id = ?`, params);
  return { status: 200, ok: true };
}

export async function runSync(db, deps = {}) {
  return syncChannel(db, {
    fetchText: deps.fetchText ?? defaultFetchText,
    fetchBytes: deps.fetchBytes ?? defaultFetchBytes,
    now: new Date(),
    pageBudget: 6,
    photoBudget: 25,
  });
}

export async function refreshOne(db, id, deps = {}) {
  return refreshItem(db, {
    itemId: id,
    fetchText: deps.fetchText ?? defaultFetchText,
    now: new Date(),
  });
}

export async function adminOverview(db) {
  return { items: await listAdminItems(db), lastSync: await lastSync(db) };
}
