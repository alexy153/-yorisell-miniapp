// Локальный сервер для разработки: приложение из web/ и API на той же логике, что на Cloudflare.
// По умолчанию каталог берётся из сохранённых страниц канала (без сети). LIVE=1 — с настоящего канала.
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./d1-sqlite.js";
import { handleRequest } from "../worker/src/router.js";
import { syncChannel } from "../worker/src/sync.js";
import { fetchBytes, fetchText } from "../worker/src/fetchers.js";
import { first } from "../worker/src/db.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(ROOT, "web");
const FIXTURES = join(ROOT, "tests", "fixtures");
const DATA = join(ROOT, "data");
const PORT = Number(process.env.PORT) || 8787;
const LIVE = process.env.LIVE === "1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

mkdirSync(DATA, { recursive: true });
const DB = openDatabase(join(DATA, "dev.sqlite"));
// Секреты для локальной разработки не настоящие. ADMIN_ID пустой: админка здесь закрыта.
const env = { DB, BOT_TOKEN: "dev-token-not-real", ADMIN_ID: process.env.ADMIN_ID ?? "" };

// Загрузчики: с настоящего канала (LIVE=1) или из сохранённых фикстур без сети.
const loaders = LIVE ? { fetchText, fetchBytes } : fixtureFetchers();

// Оффлайн-загрузчики: страницы берём из фикстур, фото — простые серые картинки.
function fixtureFetchers() {
  const pages = new Map([
    ["https://t.me/s/Yorisell", readFileSync(join(FIXTURES, "channel-latest.html"), "utf8")],
    ["https://t.me/s/Yorisell?before=170", readFileSync(join(FIXTURES, "channel-older.html"), "utf8")],
  ]);
  return {
    fetchText: async (url) => pages.get(url) ?? "<html></html>",
    fetchBytes: async (url) => ({ bytes: placeholderImage(url), contentType: "image/svg+xml" }),
  };
}

function placeholderImage(url) {
  const seed = [...url].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const tone = 58 + (seed % 36);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
    `<rect width="600" height="600" fill="rgb(${tone},${tone + 3},${tone + 9})"/>` +
    `<circle cx="300" cy="250" r="110" fill="rgba(255,255,255,0.10)"/>` +
    `<rect x="190" y="400" width="220" height="30" rx="15" fill="rgba(255,255,255,0.10)"/></svg>`;
  return new TextEncoder().encode(svg);
}

async function seedCatalog() {
  const row = await first(DB, "SELECT COUNT(*) AS n FROM items");
  if (row.n > 0 && !LIVE) return;
  // Локально обращения ничем не ограничены, поэтому архив загружается целиком.
  const result = await syncChannel(DB, {
    fetchText: loaders.fetchText,
    fetchBytes: loaders.fetchBytes,
    now: new Date(),
    budget: Number.POSITIVE_INFINITY,
  });
  console.log(
    `каталог: новых товаров ${result.created}, архив ${result.archiveDone ? "загружен целиком" : "загружен не полностью"}`,
  );
}

async function toWebRequest(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

async function serveStatic(pathname, res) {
  let relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  if (relative.endsWith("/")) relative += "index.html"; // как у Cloudflare: /admin/ открывает admin/index.html
  const file = resolve(WEB, normalize(relative));
  if (!file.startsWith(WEB + sep)) {
    res.writeHead(403).end("запрещено");
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("не найдено");
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname.startsWith("/api/") || pathname.startsWith("/img/")) {
      const response = await handleRequest(await toWebRequest(req), env, { ...loaders });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    await serveStatic(pathname, res);
  } catch (error) {
    console.error(error);
    res.writeHead(500).end("ошибка сервера");
  }
});

await seedCatalog();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Yorisell: http://localhost:${PORT}  (остановить: Ctrl+C)`);
});
