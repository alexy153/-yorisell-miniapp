// Маршруты сервера. Админ-маршруты проверяются гардом раньше любой логики.
import { requireAdmin } from "./auth.js";
import { getCatalog, getItemsByIds, getItemDetail } from "./catalog.js";
import { EVENT_KINDS, getStats, recordEvent } from "./events.js";
import { adminOverview, patchItem, refreshOne, reorderItems, runSync } from "./admin.js";
import { loadPhoto } from "./photos.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function notFound() {
  return json({ error: "not found" }, 404);
}

async function readJson(request, maxBytes) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "слишком большой запрос");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "нужен JSON");
  }
}

function parseIds(raw) {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)].slice(0, 100);
}

export async function handleRequest(request, env, options = {}) {
  try {
    return await route(request, env, options);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(error); // подробности — в журнал Cloudflare, клиенту — общая фраза
    return json({ error: "внутренняя ошибка" }, 500);
  }
}

async function route(request, env, options) {
  const url = new URL(request.url);
  const { pathname: path } = url;
  const { method } = request;

  if (path === "/api/health" && method === "GET") return json({ ok: true });

  if (path.startsWith("/api/admin/")) {
    const guard = await requireAdmin(request, env, options);
    if (!guard.ok) return json({ error: guard.error }, guard.status);
    return adminRoute(request, env, options, url, method);
  }

  if (path.startsWith("/api/")) return publicRoute(request, env, url, method);

  const photo = /^\/img\/(\d+)$/.exec(path);
  if (photo && method === "GET") return imageResponse(env, Number(photo[1]), options);

  if (env.ASSETS) return env.ASSETS.fetch(request); // статика приложения (web/)
  return notFound();
}

async function publicRoute(request, env, url, method) {
  const { pathname: path } = url;

  if (method === "GET" && path === "/api/catalog") return json(await getCatalog(env.DB));

  if (method === "GET" && path === "/api/items") {
    return json({ items: await getItemsByIds(env.DB, parseIds(url.searchParams.get("ids"))) });
  }

  const detail = /^\/api\/items\/(\d+)$/.exec(path);
  if (detail && method === "GET") {
    const item = await getItemDetail(env.DB, Number(detail[1]));
    return item ? json(item) : notFound();
  }

  if (path === "/api/events" && method === "POST") {
    const body = await readJson(request, 1024);
    if (!EVENT_KINDS.has(body.kind)) throw new HttpError(400, "неизвестное событие");
    const itemId = body.kind === "visit" ? 0 : Number(body.itemId);
    if (body.kind !== "visit" && !(Number.isInteger(itemId) && itemId > 0)) {
      throw new HttpError(400, "нужен номер товара");
    }
    await recordEvent(env.DB, { kind: body.kind, itemId });
    return new Response(null, { status: 204 });
  }

  return notFound();
}

// Фото отдаём из базы. Копия сохраняется при синхронизации; если её нет, берём из CDN канала.
async function imageResponse(env, id, options) {
  let photo;
  try {
    photo = await loadPhoto(env.DB, id, options);
  } catch (error) {
    // CDN недоступен или база не ответила: покупателю — 404, подробности — в журнал.
    console.error(error);
    return notFound();
  }
  if (!photo) return notFound();
  return new Response(photo.body, {
    headers: {
      "content-type": photo.content_type,
      "cache-control": "public, max-age=2592000",
    },
  });
}

async function adminRoute(request, env, options, url, method) {
  const { pathname: path } = url;

  if (method === "GET" && path === "/api/admin/ping") return json({ ok: true });

  if (method === "GET" && path === "/api/admin/items") return json(await adminOverview(env.DB));

  // Порядок показа: список всех номеров товаров в нужной последовательности.
  if (method === "PUT" && path === "/api/admin/order") {
    const body = await readJson(request, 32768);
    const result = await reorderItems(env.DB, body?.ids);
    return json(result.ok ? { ok: true } : { error: result.error }, result.status);
  }

  const item = /^\/api\/admin\/items\/(\d+)$/.exec(path);
  if (item && method === "PATCH") {
    const body = await readJson(request, 8192);
    const result = await patchItem(env.DB, Number(item[1]), body);
    return json(result.ok ? { ok: true } : { error: result.error }, result.status);
  }

  const refresh = /^\/api\/admin\/items\/(\d+)\/refresh$/.exec(path);
  if (refresh && method === "POST") {
    const result = await refreshOne(env.DB, Number(refresh[1]), options);
    return result.found ? json(result) : json({ error: "поста с этим номером нет в канале" }, 404);
  }

  if (method === "POST" && path === "/api/admin/sync") return json(await runSync(env.DB, options));

  if (method === "GET" && path === "/api/admin/stats") {
    // days=0 — за всё время; иначе от 1 до 3650 дней, по умолчанию 7.
    const raw = url.searchParams.get("days");
    const days = raw === "0" ? 0 : Math.min(Math.max(Number(raw) || 7, 1), 3650);
    return json(await getStats(env.DB, { days }));
  }

  return notFound();
}
