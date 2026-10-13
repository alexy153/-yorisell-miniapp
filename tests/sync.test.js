import { test } from "node:test";
import assert from "node:assert/strict";
import { cachePhotos, categoryFor, refreshItem, syncChannel } from "../worker/src/sync.js";
import { patchItem } from "../worker/src/admin.js";
import { first } from "../worker/src/db.js";
import { createTestEnv, fixtureFetchers, fixtureText } from "./helpers.js";

const NOW = new Date("2026-10-13T10:00:00Z");

async function count(db, sql) {
  return (await first(db, sql)).n;
}

test("первая синхронизация: 8 товаров, 4 пометки SOLD, все фото скачаны", async () => {
  const env = createTestEnv();
  const fetchers = fixtureFetchers();
  const result = await syncChannel(env.DB, { ...fetchers, now: NOW, photoBudget: 100 });

  assert.equal(result.listings, 8);
  assert.equal(result.created, 8);
  assert.equal(result.soldMarks, 4);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM items"), 8);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos"), 40);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE body IS NULL"), 0);
  assert.equal(result.photosPending, 0);
});

test("обходит страницы назад и останавливается на пустой", async () => {
  const env = createTestEnv();
  const fetchers = fixtureFetchers();
  await syncChannel(env.DB, { ...fetchers, now: NOW, photoBudget: 100 });
  assert.deepEqual(fetchers.pageRequests, [
    "https://t.me/s/Yorisell",
    "https://t.me/s/Yorisell?before=170",
    "https://t.me/s/Yorisell?before=148",
  ]);
});

test("повторная синхронизация не создаёт дубли и читает только первые страницы", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fakeFetchers(), now: NOW, photoBudget: 100 });
  const fetchers = fixtureFetchers();
  const again = await syncChannel(env.DB, { ...fetchers, now: NOW, photoBudget: 100 });

  assert.equal(again.created, 0);
  assert.equal(again.pages, 2);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM items"), 8);
});

test("фото скачиваются порциями: бюджет ограничивает запросы за один запуск", async () => {
  const env = createTestEnv();
  const fetchers = fixtureFetchers();
  const first_run = await syncChannel(env.DB, { ...fetchers, now: NOW, photoBudget: 25 });
  assert.equal(first_run.photosCached, 25);
  assert.equal(first_run.photosPending, 15);
  assert.equal(fetchers.photoRequests.length, 25);

  const second = await cachePhotos(env.DB, fetchers.fetchBytes, 100);
  assert.equal(second.photosCached, 15);
  assert.equal(second.photosPending, 0);
});

test("ручная правка владельца не перезаписывается синхронизацией", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, photoBudget: 0 });
  const edit = await patchItem(env.DB, 170, { title: "Свитшот владельца" });
  assert.equal(edit.ok, true);

  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, photoBudget: 0 });
  const row = await first(env.DB, "SELECT title, manual_fields FROM items WHERE id = 170");
  assert.equal(row.title, "Свитшот владельца");
  assert.deepEqual(JSON.parse(row.manual_fields), ["title"]);
});

test("товар из канала со служебными строками: описание и цена подтягиваются", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, photoBudget: 0 });
  const row = await first(env.DB, "SELECT title, description, price_rub, size, fit FROM items WHERE id = 165");
  assert.equal(row.title, "Худи Burberry Brit");
  assert.equal(row.price_rub, 9650);
  assert.equal(row.size, "L");
  assert.equal(row.fit, "M, L");
  assert.equal(row.description, "Очень интересный худак,идеально подходит на каждый день");
});

test("проданный товар помечается через пост SOLD, даже если сам он на другой странице", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, photoBudget: 0 });
  const marks = await count(env.DB, "SELECT COUNT(*) AS n FROM sold_marks");
  assert.equal(marks, 4);
  const sold = await first(env.DB, "SELECT sold_post_id FROM sold_marks WHERE item_id = 180");
  assert.equal(sold.sold_post_id, 185);
});

test("обновление одного товара читает страницу, где есть его пост", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, photoBudget: 0 });
  const fetchers = fixtureFetchers({
    pages: { "https://t.me/s/Yorisell?before=166": fixtureText("channel-older.html") },
  });
  const result = await refreshItem(env.DB, { itemId: 165, fetchText: fetchers.fetchText, now: NOW });
  assert.equal(result.found, true);
  assert.equal(result.updated, 1);
  assert.deepEqual(fetchers.pageRequests, ["https://t.me/s/Yorisell?before=166"]);
});

test("обновление несуществующего поста: found = false", async () => {
  const env = createTestEnv();
  const result = await refreshItem(env.DB, { itemId: 999, fetchText: fixtureFetchers().fetchText, now: NOW });
  assert.equal(result.found, false);
});

test("категория по названию и размеру", () => {
  assert.equal(categoryFor({ title: "Худи Burberry Brit" }), "Худи");
  assert.equal(categoryFor({ title: "Свитшот Stone Island" }), "Свитеры");
  assert.equal(categoryFor({ title: "Свитер Stone Island" }), "Свитеры");
  assert.equal(categoryFor({ title: "Футболка Alexander McQueen SS19" }), "Футболки");
  assert.equal(categoryFor({ title: "Bottega Veneta vintage 2014", sizeNote: "27,2-27,5" }), "Обувь");
  assert.equal(categoryFor({ title: "Что-то другое" }), "Другое");
});

function fakeFetchers() {
  return fixtureFetchers();
}
