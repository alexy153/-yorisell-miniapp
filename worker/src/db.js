// Тонкая обёртка над базой. Одинаково работает с D1 (Cloudflare) и с SQLite в тестах и на локальном сервере.

export async function all(db, sql, params = []) {
  return (await db.prepare(sql).bind(...params).all()).results;
}

export async function first(db, sql, params = []) {
  return db.prepare(sql).bind(...params).first();
}

export async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}
