// Разбор реальных страниц канала, сохранённых в tests/fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseChannelPage } from "../worker/src/parser.js";

const latest = parseChannelPage(readFileSync(new URL("./fixtures/channel-latest.html", import.meta.url), "utf8"));
const older = parseChannelPage(readFileSync(new URL("./fixtures/channel-older.html", import.meta.url), "utf8"));
const byId = (list, id) => list.find((post) => post.postId === id);

test("на страницах найдены все посты", () => {
  assert.equal(latest.length, 7);
  assert.equal(older.length, 5);
});

test("товар: название, состояние, размер, посадка, цена, описание, фото и дата", () => {
  const post = byId(latest, 170);
  assert.equal(post.kind, "listing");
  assert.equal(post.title, "Свитшот Stone Island");
  assert.equal(post.condition, "9.5/10(отличное)");
  assert.equal(post.size, "L");
  assert.equal(post.fit, "M, L");
  assert.equal(post.priceRub, 12350);
  assert.equal(post.description, "Красивый базовый свит от стоника,идеально подходит на каждый день");
  assert.equal(post.photos.length, 5);
  assert.ok(post.photos.every((url) => url.startsWith("https://cdn4.telesco.pe/file/")));
  assert.equal(post.publishedAt, "2026-06-18T16:20:48+00:00");
  assert.equal(post.views, 161);
  assert.equal(post.url, "https://t.me/Yorisell/170");
});

test("служебные строки (встреча, Авито, связь) не попадают в описание и название", () => {
  for (const post of latest.filter((p) => p.kind === "listing")) {
    assert.ok(!/Личная встреча|Замеры\/вопросы|Связь:|Авито/.test(post.description ?? ""), `post ${post.postId}`);
    assert.ok(!/Личная встреча|Связь:/.test(post.title ?? ""), `post ${post.postId}`);
  }
});

test("эмодзи убраны из названия и цены", () => {
  for (const post of [...latest, ...older]) {
    if (post.title) assert.ok(!/\p{Extended_Pictographic}/u.test(post.title), `post ${post.postId}: ${post.title}`);
  }
});

test("размер с примечанием в скобках (обувь): примечание не путается с посадкой", () => {
  const post = byId(latest, 180);
  assert.equal(post.kind, "listing");
  assert.equal(post.title, "Bottega Veneta vintage 2014");
  assert.equal(post.size, "42");
  assert.equal(post.sizeNote, "27,2-27,5");
  assert.equal(post.fit, null);
  assert.equal(post.priceRub, 24440);
  assert.equal(post.condition, "10/10");
  assert.equal(post.description, "Очень редкий айтем для рф,идеально подходит на каждый день");
});

test("пост SOLD: отмечает товар и указывает на его пост, цены у него нет", () => {
  const sold = byId(latest, 185);
  assert.equal(sold.kind, "sold");
  assert.equal(sold.isSold, true);
  assert.equal(sold.replyToPostId, 180);
  assert.equal(sold.priceRub, null);
  assert.equal(sold.title, null);
});

test("старая страница: проданный товар и обычный товар", () => {
  const sold = byId(older, 159);
  assert.equal(sold.kind, "sold");
  assert.equal(sold.replyToPostId, 133);

  const listing = byId(older, 165);
  assert.equal(listing.kind, "listing");
  assert.equal(listing.title, "Худи Burberry Brit");
  assert.equal(listing.size, "L");
  assert.equal(listing.fit, "M, L");
  assert.equal(listing.priceRub, 9650);
  assert.equal(listing.condition, "10/10");
});

test("посты без цены и без SOLD не считаются товаром", () => {
  const html = `<div class="tgme_widget_message js-widget_message" data-post="Yorisell/999"><div class="tgme_widget_message_text js-message_text" dir="auto">Просто новость без товара</div><div class="tgme_widget_message_reactions js-message_reactions"></div></div>`;
  const [post] = parseChannelPage(html);
  assert.equal(post.kind, "other");
  assert.equal(post.priceRub, null);
});
