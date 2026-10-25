import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryFor, refreshItem, syncChannel } from "../worker/src/sync.js";
import { patchItem } from "../worker/src/admin.js";
import { first } from "../worker/src/db.js";
import { createTestEnv, fixtureFetchers, fixtureText } from "./helpers.js";

const NOW = new Date("2026-10-13T10:00:00Z");
const NO_LIMIT = Number.POSITIVE_INFINITY;
const OLDER_PAGE = "https://t.me/s/Yorisell?before=166";

// Страницы «до номера» для всех постов канала: по ним догружаются фото старых товаров.
function allPages() {
  const pages = {};
  for (let n = 149; n <= 166; n++) pages[`https://t.me/s/Yorisell?before=${n}`] = fixtureText("channel-older.html");
  for (let n = 171; n <= 188; n++) pages[`https://t.me/s/Yorisell?before=${n}`] = fixtureText("channel-latest.html");
  return pages;
}

async function count(db, sql) {
  return (await first(db, sql)).n;
}

async function exec(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

test("первая синхронизация: 8 товаров, 4 пометки SOLD, все 40 фото сохранены в базе", async () => {
  const env = createTestEnv();
  const fetchers = fixtureFetchers();
  const result = await syncChannel(env.DB, { ...fetchers, now: NOW, budget: NO_LIMIT });

  assert.equal(result.listings, 8);
  assert.equal(result.created, 8);
  assert.equal(result.soldMarks, 4);
  assert.equal(result.archiveDone, true);
  assert.equal(result.stopped, null);
  assert.equal(result.photosSaved, 40);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM items"), 8);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos"), 40);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE body IS NULL"), 0);
  assert.equal(fetchers.photoRequests.length, 40);
});

test("архив идёт назад от первой страницы и останавливается на пустой", async () => {
  const env = createTestEnv();
  const fetchers = fixtureFetchers();
  await syncChannel(env.DB, { ...fetchers, now: NOW, budget: NO_LIMIT });
  assert.deepEqual(fetchers.pageRequests, [
    "https://t.me/s/Yorisell",
    "https://t.me/s/Yorisell?before=170",
    "https://t.me/s/Yorisell?before=148",
  ]);
});

test("повторная синхронизация без изменений ничего не пишет и читает только первую страницу", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const fetchers = fixtureFetchers();
  const again = await syncChannel(env.DB, { ...fetchers, now: NOW, budget: NO_LIMIT });

  assert.equal(again.created, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.soldMarks, 0);
  assert.equal(again.photosSaved, 0);
  assert.equal(again.pages, 1);
  assert.deepEqual(fetchers.pageRequests, ["https://t.me/s/Yorisell"]);
  assert.equal(fetchers.photoRequests.length, 0);
  // Чтение: четыре таблицы (товары, фото, пометки, фото без копии), курсор и первая страница. Записей нет.
  assert.equal(again.used, 6);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM items"), 8);
});

test("бюджет ограничивает запуск, а следующие запуски догружают архив и фото до конца", async () => {
  const env = createTestEnv();
  const fetchers = fixtureFetchers({ pages: allPages() });
  const reports = [];
  let report;
  let unsaved;
  do {
    report = await syncChannel(env.DB, { ...fetchers, now: NOW, budget: 12 });
    reports.push(report);
    unsaved = await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE body IS NULL");
  } while ((!report.archiveDone || unsaved > 0) && reports.length < 300);

  assert.ok(reports.length > 1, "архив не должен уместиться в один запуск с таким бюджетом");
  assert.equal(reports[0].stopped, "budget");
  assert.ok(
    reports.every((item) => item.used <= 12),
    "ни один запуск не вышел за бюджет",
  );
  assert.equal(report.archiveDone, true);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM items"), 8);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM sold_marks"), 4);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos"), 40);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE body IS NULL"), 0);
});

test("фото, которые не сохранились, догружаются на следующем запуске, пока ссылка свежая", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const before = await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE item_id = 170");
  await exec(env.DB, "UPDATE photos SET body = NULL WHERE item_id = 170");

  const again = await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  assert.equal(again.photosSaved, before);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE item_id = 170 AND body IS NULL"), 0);
});

test("фото старых постов догружаются со страницы поста, когда их не сохранили раньше", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const before = await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE item_id = 165");
  await exec(env.DB, "UPDATE photos SET body = NULL WHERE item_id = 165");

  const fetchers = fixtureFetchers({ pages: { [OLDER_PAGE]: fixtureText("channel-older.html") } });
  const again = await syncChannel(env.DB, { ...fetchers, now: NOW, budget: NO_LIMIT });
  assert.equal(again.photosSaved, before);
  assert.ok(fetchers.pageRequests.includes(OLDER_PAGE));
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM photos WHERE item_id = 165 AND body IS NULL"), 0);
});

test("ручная правка владельца не перезаписывается синхронизацией", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const edit = await patchItem(env.DB, 170, { title: "Свитшот владельца" });
  assert.equal(edit.ok, true);

  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const row = await first(env.DB, "SELECT title, manual_fields FROM items WHERE id = 170");
  assert.equal(row.title, "Свитшот владельца");
  assert.deepEqual(JSON.parse(row.manual_fields), ["title"]);
});

test("товар из канала со служебными строками: описание и цена подтягиваются", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const row = await first(env.DB, "SELECT title, description, price_rub, size, fit FROM items WHERE id = 165");
  assert.equal(row.title, "Худи Burberry Brit");
  assert.equal(row.price_rub, 9650);
  assert.equal(row.size, "L");
  assert.equal(row.fit, "M, L");
  assert.equal(row.description, "Очень интересный худак,идеально подходит на каждый день");
});

test("проданный товар помечается через пост SOLD, даже если сам он на другой странице", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const marks = await count(env.DB, "SELECT COUNT(*) AS n FROM sold_marks");
  assert.equal(marks, 4);
  const sold = await first(env.DB, "SELECT sold_post_id FROM sold_marks WHERE item_id = 180");
  assert.equal(sold.sold_post_id, 185);
});

test("обновление одного товара читает страницу, где есть его пост, и применяет изменения", async () => {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, budget: NO_LIMIT });
  const older = fixtureText("channel-older.html").replace("Худи Burberry Brit", "Худи Burberry Brit (обновлено)");
  const fetchers = fixtureFetchers({ pages: { [OLDER_PAGE]: older } });

  const result = await refreshItem(env.DB, { itemId: 165, fetchText: fetchers.fetchText, now: NOW });
  assert.equal(result.found, true);
  assert.equal(result.updated, 1);
  assert.deepEqual(fetchers.pageRequests, [OLDER_PAGE]);
  const row = await first(env.DB, "SELECT title FROM items WHERE id = 165");
  assert.equal(row.title, "Худи Burberry Brit (обновлено)");
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
  assert.equal(categoryFor({ title: "Джинсы Levi's 501" }), "Джинсы");
  assert.equal(categoryFor({ title: "Jeans Diesel Larkee" }), "Джинсы");
  assert.equal(categoryFor({ title: "Джинсы-карго Carhartt" }), "Джинсы");
});
