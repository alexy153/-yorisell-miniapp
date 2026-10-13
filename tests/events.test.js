import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKey, getStats, recordEvent } from "../worker/src/events.js";
import { all } from "../worker/src/db.js";
import { createTestEnv } from "./helpers.js";

test("день для статистики считается по Москве (UTC+3)", () => {
  assert.equal(dayKey(new Date("2026-10-12T22:30:00Z")), "2026-10-13");
  assert.equal(dayKey(new Date("2026-10-12T20:59:00Z")), "2026-10-12");
});

test("счётчики суммируются по дням и товарам", async () => {
  const { DB } = createTestEnv();
  const now = new Date("2026-10-13T10:00:00Z");
  await recordEvent(DB, { kind: "visit", now });
  await recordEvent(DB, { kind: "visit", now });
  await recordEvent(DB, { kind: "open", itemId: 170, now });
  await recordEvent(DB, { kind: "book", itemId: 170, now });
  await recordEvent(DB, { kind: "favorite", itemId: 170, now });

  const stats = await getStats(DB, { days: 7, now });
  assert.equal(stats.totals.visits, 2);
  assert.equal(stats.totals.opens, 1);
  assert.equal(stats.totals.books, 1);
  assert.equal(stats.totals.favorites, 1);
  assert.deepEqual(stats.items, [{ id: 170, opens: 1, books: 1, favorites: 1 }]);
});

test("старые события не попадают в период", async () => {
  const { DB } = createTestEnv();
  await recordEvent(DB, { kind: "visit", now: new Date("2026-09-01T10:00:00Z") });
  const stats = await getStats(DB, { days: 7, now: new Date("2026-10-13T10:00:00Z") });
  assert.equal(stats.totals.visits, 0);
});

test("в статистике нет персональных данных: только день, вид события, номер товара и число", async () => {
  const { DB } = createTestEnv();
  const columns = (await all(DB, "PRAGMA table_info(events)")).map((c) => c.name);
  assert.deepEqual(columns, ["day", "kind", "item_id", "n"]);
});
