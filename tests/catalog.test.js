import { test } from "node:test";
import assert from "node:assert/strict";
import { syncChannel } from "../worker/src/sync.js";
import { patchItem } from "../worker/src/admin.js";
import { getCatalog, getItemDetail, getItemsByIds } from "../worker/src/catalog.js";
import { createTestEnv, fixtureFetchers } from "./helpers.js";

const NOW = new Date("2026-10-13T10:00:00Z");

async function syncedEnv() {
  const env = createTestEnv();
  await syncChannel(env.DB, { ...fixtureFetchers(), now: NOW, photoBudget: 100 });
  return env;
}

test("каталог: проданные не показываются, категории и счётчики верные", async () => {
  const { DB } = await syncedEnv();
  const catalog = await getCatalog(DB);

  // 8 товаров, из них 160 и 180 проданы.
  assert.equal(catalog.items.length, 6);
  assert.ok(!catalog.items.some((item) => item.id === 160 || item.id === 180));
  assert.deepEqual(catalog.categories[0], { key: "all", title: "Все", count: 6 });
  assert.deepEqual(
    catalog.categories.slice(1).map((c) => [c.key, c.count]),
    [
      ["Худи", 1],
      ["Свитеры", 4],
      ["Футболки", 1],
    ],
  );
});

test("каталог: карточка содержит фото, цену, размер и посадку", async () => {
  const { DB } = await syncedEnv();
  const card = (await getCatalog(DB)).items.find((item) => item.id === 170);
  assert.equal(card.title, "Свитшот Stone Island");
  assert.equal(card.priceRub, 12350);
  assert.equal(card.size, "L");
  assert.equal(card.fit, "M, L");
  assert.match(card.coverUrl, /^\/img\/\d+$/);
});

test("скрытый владельцем товар исчезает из каталога и из карточки", async () => {
  const { DB } = await syncedEnv();
  await patchItem(DB, 170, { visible: false });
  assert.equal((await getCatalog(DB)).items.length, 5);
  assert.equal(await getItemDetail(DB, 170), null);
});

test("ручная пометка «в наличии» снимает отметку SOLD из канала", async () => {
  const { DB } = await syncedEnv();
  await patchItem(DB, 160, { soldManual: false });
  const ids = (await getCatalog(DB)).items.map((item) => item.id);
  assert.ok(ids.includes(160));
});

test("ручная пометка «продано» скрывает товар из каталога", async () => {
  const { DB } = await syncedEnv();
  await patchItem(DB, 175, { soldManual: true });
  assert.ok(!(await getCatalog(DB)).items.some((item) => item.id === 175));
});

test("избранное получает проданные товары с пометкой, скрытые — нет", async () => {
  const { DB } = await syncedEnv();
  await patchItem(DB, 170, { visible: false });
  const items = await getItemsByIds(DB, [160, 165, 170, 999]);
  assert.deepEqual(
    items.map((item) => [item.id, item.sold]),
    [
      [160, true],
      [165, false],
    ],
  );
});

test("карточка товара: описание, фото, ссылка на бронь, замеров нет — «Замеры в ЛС»", async () => {
  const { DB } = await syncedEnv();
  const item = await getItemDetail(DB, 170);
  assert.equal(item.title, "Свитшот Stone Island");
  assert.equal(item.condition, "9.5/10(отличное)");
  assert.equal(item.description, "Красивый базовый свит от стоника,идеально подходит на каждый день");
  assert.equal(item.measurements, null);
  assert.equal(item.photos.length, 5);
  assert.equal(item.sold, false);
  assert.ok(item.bookingUrl.startsWith("https://t.me/Alexy153?text="));
  assert.ok(decodeURIComponent(item.bookingUrl).includes("https://t.me/Yorisell/170"));
});

test("карточка проданного товара помечена sold: true", async () => {
  const { DB } = await syncedEnv();
  assert.equal((await getItemDetail(DB, 180)).sold, true);
});

test("обложку можно выбрать вручную из фото этого товара", async () => {
  const { DB } = await syncedEnv();
  const detail = await getItemDetail(DB, 170);
  const secondPhotoId = Number(detail.photos[1].replace("/img/", ""));
  assert.equal((await patchItem(DB, 170, { coverPhotoId: secondPhotoId })).ok, true);
  assert.equal((await getItemDetail(DB, 170)).coverUrl, `/img/${secondPhotoId}`);
  const foreign = await patchItem(DB, 170, { coverPhotoId: Number(detail.photos[0].replace("/img/", "")) + 1000 });
  assert.equal(foreign.status, 400);
});
