// Анонимные счётчики: показы, открытия, нажатия «Забронировать» и «♡».
// Telegram ID и IP не сохраняем: только числа по дням и по товарам.
import { all, run } from "./db.js";

export const EVENT_KINDS = new Set(["visit", "open", "book", "favorite", "unfavorite"]);

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// День по Москве (UTC+3, без летнего времени).
export function dayKey(date) {
  return new Date(date.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

export async function recordEvent(db, { kind, itemId = 0, now = new Date() }) {
  await run(
    db,
    `INSERT INTO events (day, kind, item_id, n) VALUES (?, ?, ?, 1)
     ON CONFLICT (day, kind, item_id) DO UPDATE SET n = n + 1`,
    [dayKey(now), kind, itemId],
  );
}

export async function getStats(db, { days = 7, now = new Date() } = {}) {
  const since = dayKey(new Date(now.getTime() - (days - 1) * DAY_MS));
  const perDay = await all(
    db,
    "SELECT day, SUM(n) AS n FROM events WHERE day >= ? AND kind = 'visit' GROUP BY day ORDER BY day",
    [since],
  );
  const perItem = await all(
    db,
    "SELECT item_id, kind, SUM(n) AS n FROM events WHERE day >= ? AND item_id > 0 GROUP BY item_id, kind",
    [since],
  );

  const totals = { visits: 0, opens: 0, books: 0, favorites: 0 };
  for (const row of perDay) totals.visits += row.n;

  const items = new Map();
  for (const row of perItem) {
    const entry = items.get(row.item_id) ?? { id: row.item_id, opens: 0, books: 0, favorites: 0 };
    if (row.kind === "open") entry.opens += row.n;
    if (row.kind === "book") entry.books += row.n;
    if (row.kind === "favorite") entry.favorites += row.n;
    items.set(row.item_id, entry);
    if (row.kind === "open") totals.opens += row.n;
    if (row.kind === "book") totals.books += row.n;
    if (row.kind === "favorite") totals.favorites += row.n;
  }

  return {
    since,
    totals,
    days: perDay.map((row) => ({ day: row.day, visits: row.n })),
    items: [...items.values()].sort((a, b) => b.opens - a.opens),
  };
}
