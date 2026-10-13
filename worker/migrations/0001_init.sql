-- Схема базы D1 (совместима с SQLite). Миграции применяются по порядку номеров.

-- Товары: один товар = один пост канала с ценой. id = номер поста.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Другое',
  description TEXT,
  item_condition TEXT,
  size TEXT,
  size_note TEXT,
  fit TEXT,
  price_rub INTEGER NOT NULL,
  measurements TEXT,                          -- замеры от владельца; NULL = «Замеры в ЛС»
  published_at TEXT,
  post_url TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,         -- 0 = скрыт владельцем
  sold_manual INTEGER,                        -- NULL = как в канале, 0 = в наличии, 1 = продано
  sort_order INTEGER,                         -- NULL = по дате публикации
  cover_photo_id INTEGER,                     -- обложка; NULL = первое фото
  manual_fields TEXT NOT NULL DEFAULT '[]',   -- поля, которые правил владелец: синхронизация их не трогает
  synced_at TEXT
);

-- Фото товара. body — скачанная копия (NULL, пока не скачана).
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  content_type TEXT,
  body BLOB,
  UNIQUE (item_id, position)
);

-- Пост «SOLD» в канале ссылается на проданный товар.
CREATE TABLE IF NOT EXISTS sold_marks (
  item_id INTEGER PRIMARY KEY,
  sold_post_id INTEGER NOT NULL,
  seen_at TEXT NOT NULL
);

-- Анонимные счётчики: без Telegram ID и без IP. item_id = 0 для показов сайта.
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL DEFAULT 0,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, item_id)
);

-- Служебное состояние: когда и что синхронизировалось.
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_listing ON items (visible, sort_order, published_at);
