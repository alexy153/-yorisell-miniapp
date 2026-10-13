// База для тестов и локального сервера: встроенная SQLite Node с тем же API, что у D1 (prepare, bind, all, first, run).
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../worker/migrations/", import.meta.url));

// Открывает базу и применяет все миграции по порядку.
export function openDatabase(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    db.exec(readFileSync(MIGRATIONS + name, "utf8"));
  }
  return wrap(db);
}

function wrap(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let params = [];
      const api = {
        bind(...values) {
          params = values.map((value) => (value === undefined ? null : value));
          return api;
        },
        async all() {
          return { results: statement.all(...params), success: true };
        },
        async first(column) {
          const row = statement.get(...params);
          if (row === undefined) return null;
          return column ? row[column] : row;
        },
        async run() {
          const info = statement.run(...params);
          return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
        },
      };
      return api;
    },
  };
}
