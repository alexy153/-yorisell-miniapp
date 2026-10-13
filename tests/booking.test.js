import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBookingUrl, buildBookingText, formatRub } from "../worker/src/booking.js";

test("цена форматируется с пробелами между тысячами", () => {
  assert.equal(formatRub(19930), "19 930 ₽");
  assert.equal(formatRub(9650), "9 650 ₽");
  assert.equal(formatRub(1000000), "1 000 000 ₽");
});

test("ссылка ведёт в личку продавца с готовым текстом", () => {
  const url = new URL(
    buildBookingUrl({ title: "Худи Burberry Brit", size: "L", priceRub: 9650, postId: 165 }),
  );
  assert.equal(url.origin + url.pathname, "https://t.me/Alexy153");
  assert.equal(
    url.searchParams.get("text"),
    "Хочу забронировать: Худи Burberry Brit, размер L, 9 650 ₽\nhttps://t.me/Yorisell/165",
  );
});

test("спецсимволы в названии правильно кодируются и читаются обратно", () => {
  const title = "Футболка & Co #1 «Vintage» 100%";
  const url = new URL(buildBookingUrl({ title, size: "M", priceRub: 6750, postId: 154 }));
  assert.match(url.searchParams.get("text"), /Футболка & Co #1 «Vintage» 100%/);
});

test("текст не превышает лимит Telegram", () => {
  const longTitle = "А".repeat(10000);
  const text = buildBookingText({ title: longTitle, size: "L", priceRub: 1000, postId: 1 });
  assert.ok(Array.from(text).length <= 4096);
});

test("без размера и поста текст всё равно корректен", () => {
  assert.equal(buildBookingText({ title: "Свитер", size: null, priceRub: 13140, postId: null }), "Хочу забронировать: Свитер, 13 140 ₽");
});
