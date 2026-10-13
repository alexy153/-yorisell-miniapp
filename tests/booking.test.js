import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBookingUrl, buildBookingText } from "../worker/src/booking.js";

test("ссылка ведёт в личку продавца с текстом: просьба и ссылка на пост", () => {
  const url = new URL(buildBookingUrl({ title: "Худи Burberry Brit", size: "L", priceRub: 9650, postId: 165 }));
  assert.equal(url.origin + url.pathname, "https://t.me/Alexy153");
  assert.equal(url.searchParams.get("text"), "Хочу забронировать: https://t.me/Yorisell/165");
});

test("в тексте брони нет названия, размера и цены", () => {
  const text = buildBookingText({ title: "Футболка & Co #1 «Vintage»", size: "M", priceRub: 6750, postId: 154 });
  assert.equal(text, "Хочу забронировать: https://t.me/Yorisell/154");
});

test("без номера поста текст остаётся просьбой без ссылки", () => {
  assert.equal(buildBookingText({ postId: null }), "Хочу забронировать:");
});
