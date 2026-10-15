// Маршруты целиком: публичное API, картинки, счётчики и админка с проверкой подписи.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../worker/src/router.js";
import { syncChannel } from "../worker/src/sync.js";
import { createTestEnv, fixtureFetchers, fixtureText, adminHeaders, initDataFor } from "./helpers.js";

const NOW = new Date("2026-10-13T10:00:00Z");

async function setup() {
  const env = createTestEnv();
  const fetchers = fixtureFetchers();
  await syncChannel(env.DB, { ...fetchers, now: NOW, budget: Number.POSITIVE_INFINITY });
  return { env, fetchers, options: { fetchText: fetchers.fetchText, fetchBytes: fetchers.fetchBytes } };
}

function request(path, init = {}) {
  return new Request(`https://worker.test${path}`, init);
}

function post(body, headers = {}) {
  return { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

function putJson(body, headers = {}) {
  return { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) };
}

test("публичный каталог: 6 товаров без проданных и скрытых", async () => {
  const { env, options } = await setup();
  const response = await handleRequest(request("/api/catalog"), env, options);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /json/);
  const body = await response.json();
  assert.equal(body.items.length, 6);
  assert.equal(body.categories[0].key, "all");
});

test("избранное: проданный товар приходит с пометкой, номера без товара пропускаются", async () => {
  const { env, options } = await setup();
  const response = await handleRequest(request("/api/items?ids=160,165,999,abc"), env, options);
  const body = await response.json();
  assert.deepEqual(
    body.items.map((item) => [item.id, item.sold]),
    [
      [160, true],
      [165, false],
    ],
  );
});

test("карточка товара: 200 с описанием и ссылкой на бронь; нет товара — 404", async () => {
  const { env, options } = await setup();
  const ok = await handleRequest(request("/api/items/170"), env, options);
  assert.equal(ok.status, 200);
  const item = await ok.json();
  assert.equal(item.title, "Свитшот Stone Island");
  assert.match(item.bookingUrl, /^https:\/\/t\.me\/Alexy153\?text=/);

  const missing = await handleRequest(request("/api/items/999"), env, options);
  assert.equal(missing.status, 404);
});

test("события: показ и открытие принимаются, неверные — отклоняются", async () => {
  const { env, options } = await setup();
  const visit = await handleRequest(request("/api/events", post({ kind: "visit" })), env, options);
  assert.equal(visit.status, 204);
  const open = await handleRequest(request("/api/events", post({ kind: "open", itemId: 170 })), env, options);
  assert.equal(open.status, 204);

  const unknown = await handleRequest(request("/api/events", post({ kind: "hack" })), env, options);
  assert.equal(unknown.status, 400);
  const noItem = await handleRequest(request("/api/events", post({ kind: "book" })), env, options);
  assert.equal(noItem.status, 400);
  const huge = await handleRequest(
    request("/api/events", post({ kind: "visit", pad: "x".repeat(2000) })),
    env,
    options,
  );
  assert.equal(huge.status, 413);
});

test("картинки: копии сохраняются при синхронизации, показ не ходит в CDN", async () => {
  const { env, fetchers, options } = await setup();
  const detail = await (await handleRequest(request("/api/items/170"), env, options)).json();
  const downloaded = fetchers.photoRequests.length;

  const response = await handleRequest(request(detail.coverUrl), env, options);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control"), /max-age=2592000/);
  assert.equal(fetchers.photoRequests.length, downloaded, "показ не ходит в CDN");
});

test("картинки: нет копии и CDN не отдал файл — 404, а не ошибка сервера", async () => {
  const { env, options } = await setup();
  const detail = await (await handleRequest(request("/api/items/170"), env, options)).json();
  const photoId = Number(detail.coverUrl.split("/").pop());
  await env.DB.prepare("UPDATE photos SET body = NULL WHERE id = ?").bind(photoId).run();
  const broken = {
    ...options,
    fetchBytes: async () => {
      throw new Error("CDN недоступен");
    },
  };
  const response = await handleRequest(request(detail.coverUrl), env, broken);
  assert.equal(response.status, 404);
});

test("картинки: устаревшая ссылка — берём свежую со страницы поста и сохраняем копию", async () => {
  const { env, options } = await setup();
  const detail = await (await handleRequest(request("/api/items/170"), env, options)).json();
  const photoId = Number(detail.coverUrl.split("/").pop());
  await env.DB.prepare("UPDATE photos SET body = NULL, source_url = ? WHERE id = ?")
    .bind("https://cdn4.telesco.pe/file/stale.jpg", photoId)
    .run();
  const withStale = {
    ...options,
    fetchBytes: async (url) => {
      if (url.includes("stale")) throw new Error("ссылка устарела");
      return options.fetchBytes(url);
    },
  };
  const response = await handleRequest(request(detail.coverUrl), env, withStale);
  assert.equal(response.status, 200);
  const row = await env.DB.prepare("SELECT source_url, body FROM photos WHERE id = ?").bind(photoId).first();
  assert.ok(!row.source_url.includes("stale"));
  assert.ok(row.body);
});

test("картинки: чужой адрес в базе не скачивается, берём ссылку со страницы канала", async () => {
  const { env, fetchers, options } = await setup();
  const detail = await (await handleRequest(request("/api/items/170"), env, options)).json();
  const photoId = Number(detail.coverUrl.split("/").pop());
  await env.DB.prepare("UPDATE photos SET body = NULL, source_url = ? WHERE id = ?")
    .bind("https://evil.example/x.png", photoId)
    .run();
  const before = fetchers.photoRequests.length;

  const response = await handleRequest(request(detail.coverUrl), env, options);
  assert.equal(response.status, 200);
  const requested = fetchers.photoRequests.slice(before);
  assert.ok(requested.length > 0);
  assert.ok(requested.every((url) => url.startsWith("https://cdn4.telesco.pe/")));
});

test("админ-список: без подписи 401, с подписью другого пользователя 403, с подписью админа 200", async () => {
  const { env, options } = await setup();
  assert.equal((await handleRequest(request("/api/admin/items"), env, options)).status, 401);

  const stranger = { Authorization: `tma ${initDataFor({ userId: 111 })}` };
  assert.equal((await handleRequest(request("/api/admin/items", { headers: stranger }), env, options)).status, 403);

  const ok = await handleRequest(request("/api/admin/items", { headers: adminHeaders() }), env, options);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.items.length, 8);
  assert.ok(body.lastSync);
  // Номера фото нужны, чтобы выбрать обложку, в том числе у скрытых товаров.
  const item = body.items.find((row) => row.id === 170);
  assert.equal(item.photoIds.length, item.photoCount);
});

test("админ: правка без подписи и с подменённой подписью не меняет товар", async () => {
  const { env, options } = await setup();
  const noAuth = await handleRequest(request("/api/admin/items/170", { method: "PATCH", body: "{}" }), env, options);
  assert.equal(noAuth.status, 401);

  const forged = initDataFor({ userId: 111 });
  const bad = await handleRequest(
    request("/api/admin/items/170", { ...post({ visible: false }, { Authorization: `tma ${forged}` }), method: "PATCH" }),
    env,
    options,
  );
  assert.equal(bad.status, 403);

  const still = await handleRequest(request("/api/items/170"), env, options);
  assert.equal(still.status, 200);
});

test("админ: правка с подписью владельца скрывает товар и проверяет поля", async () => {
  const { env, options } = await setup();
  const hide = await handleRequest(
    request("/api/admin/items/170", { ...post({ visible: false }, adminHeaders()), method: "PATCH" }),
    env,
    options,
  );
  assert.equal(hide.status, 200);
  assert.equal((await handleRequest(request("/api/items/170"), env, options)).status, 404);

  const wrongType = await handleRequest(
    request("/api/admin/items/175", { ...post({ visible: "yes" }, adminHeaders()), method: "PATCH" }),
    env,
    options,
  );
  assert.equal(wrongType.status, 400);

  const notJson = await handleRequest(
    request("/api/admin/items/175", { method: "PATCH", body: "не json", headers: adminHeaders() }),
    env,
    options,
  );
  assert.equal(notJson.status, 400);
});

test("админ: тело правки не из объекта (null) — 400, а не ошибка сервера", async () => {
  const { env, options } = await setup();
  const response = await handleRequest(
    request("/api/admin/items/170", { method: "PATCH", body: "null", headers: adminHeaders() }),
    env,
    options,
  );
  assert.equal(response.status, 400);
});

test("админ: порядок товаров сохраняется, покупатель видит тот же порядок", async () => {
  const { env, options } = await setup();
  const list = await (await handleRequest(request("/api/admin/items", { headers: adminHeaders() }), env, options)).json();
  const reversed = list.items.map((item) => item.id).reverse();

  const put = await handleRequest(request("/api/admin/order", putJson({ ids: reversed }, adminHeaders())), env, options);
  assert.equal(put.status, 200);

  const catalog = await (await handleRequest(request("/api/catalog"), env, options)).json();
  const expected = reversed.filter((id) => catalog.items.some((card) => card.id === id));
  assert.deepEqual(
    catalog.items.map((card) => card.id),
    expected,
  );
});

test("админ: порядок с пропущенным, повторным или чужим номером отклоняется", async () => {
  const { env, options } = await setup();
  const list = await (await handleRequest(request("/api/admin/items", { headers: adminHeaders() }), env, options)).json();
  const ids = list.items.map((item) => item.id);
  const send = (body) => handleRequest(request("/api/admin/order", putJson(body, adminHeaders())), env, options);

  assert.equal((await send({ ids: ids.slice(1) })).status, 409, "не хватает товара");
  assert.equal((await send({ ids: [...ids, 999] })).status, 409, "лишний номер");
  assert.equal((await send({ ids: [ids[0], ids[0], ...ids.slice(2)] })).status, 400, "повтор номера");
  assert.equal((await send({ ids: ["170"] })).status, 400, "номер строкой");
  assert.equal((await send({})).status, 400, "нет списка");
  assert.equal((await send(null)).status, 400, "тело не объект");
});

test("админ: порядок без подписи не меняется", async () => {
  const { env, options } = await setup();
  const response = await handleRequest(request("/api/admin/order", putJson({ ids: [170] })), env, options);
  assert.equal(response.status, 401);
});

test("админ: ручной запуск синхронизации и обновление одного товара", async () => {
  const { env, fetchers, options } = await setup();
  const sync = await handleRequest(request("/api/admin/sync", { method: "POST", headers: adminHeaders() }), env, options);
  assert.equal(sync.status, 200);
  assert.equal((await sync.json()).created, 0);

  const refreshFetchers = fixtureFetchers({
    pages: { "https://t.me/s/Yorisell?before=166": fixtureText("channel-older.html") },
  });
  const refresh = await handleRequest(
    request("/api/admin/items/165/refresh", { method: "POST", headers: adminHeaders() }),
    env,
    { fetchText: refreshFetchers.fetchText, fetchBytes: fetchers.fetchBytes },
  );
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).found, true);

  const missing = await handleRequest(
    request("/api/admin/items/999/refresh", { method: "POST", headers: adminHeaders() }),
    env,
    { fetchText: refreshFetchers.fetchText, fetchBytes: fetchers.fetchBytes },
  );
  assert.equal(missing.status, 404);
});

test("админ: статистика за период и за всё время", async () => {
  const { env, options } = await setup();
  await handleRequest(request("/api/events", post({ kind: "open", itemId: 170 })), env, options);

  const week = await handleRequest(request("/api/admin/stats?days=7", { headers: adminHeaders() }), env, options);
  assert.equal(week.status, 200);
  assert.equal((await week.json()).totals.opens, 1);

  const all = await (await handleRequest(request("/api/admin/stats?days=0", { headers: adminHeaders() }), env, options)).json();
  assert.equal(all.since, "0000-00-00");
  assert.equal(all.totals.opens, 1);
});

test("неизвестный путь: 404, а не утечка данных", async () => {
  const { env, options } = await setup();
  assert.equal((await handleRequest(request("/api/nothing"), env, options)).status, 404);
  assert.equal((await handleRequest(request("/какой-то/путь"), env, options)).status, 404);
});
