// Сборка фото витрины: из постов канала делаем две версии каждого снимка (WebP) в web/media.
// Запускается в GitHub Actions по расписанию и при выкладке. Локально: `npm run media` (живой канал)
// или `npm run media:fixtures` (без сети, цветные заглушки для разработки).
// Что уже собрано и не изменилось, не перекодируем: состояние лежит в .media-state (его кэширует Actions).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { parseChannelPage } from "../worker/src/parser.js";
import { pageUrl } from "../worker/src/sync.js";
import { WIDTHS } from "../worker/src/media.js";
import { planMedia } from "./media-plan.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "web", "media");
const STATE = join(ROOT, ".media-state");
const FIXTURES = join(ROOT, "tests", "fixtures");
const FIXTURE_MODE = process.argv.includes("--fixtures");
const USER_AGENT = "yorisell-miniapp/1.0 (+https://github.com/alexy153/-yorisell-miniapp)";
// Версия настроек кодирования: смена параметров переводит в ней все фото на перекодирование.
const ENCODER = "s540q70-l1000q80";
const CONCURRENCY = 4;
const MAX_PAGES = 60;

const hash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 16);

// Все сообщения канала, страница за страницей до конца архива.
async function readMessages() {
  if (FIXTURE_MODE) {
    return ["channel-latest.html", "channel-older.html"].flatMap((name) =>
      parseChannelPage(readFileSync(join(FIXTURES, name), "utf8")),
    );
  }
  const messages = [];
  let before = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await fetch(pageUrl(before), { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`канал ответил ${response.status}`);
    const batch = parseChannelPage(await response.text());
    if (batch.length === 0) break;
    messages.push(...batch);
    const oldest = Math.min(...batch.map((message) => message.postId));
    if (before !== null && oldest >= before) break;
    before = oldest;
  }
  return messages;
}

// Фото объявлений; номер фото в альбоме совпадает с номером в витрине (как в базе).
function collectPhotos(messages) {
  const photos = [];
  for (const message of messages) {
    if (message.kind !== "listing") continue;
    message.photos.forEach((url, index) =>
      photos.push({ itemId: message.postId, index, url, sourceHash: hash(`${ENCODER}|${url}`) }),
    );
  }
  return photos;
}

// Ключи «товар/номер», для которых на диске есть оба файла.
async function scanBuilt() {
  const built = new Set();
  const folders = await readdir(OUT).catch(() => []);
  for (const folder of folders) {
    const files = await readdir(join(OUT, folder)).catch(() => []);
    for (const file of files) {
      const match = /^(\d+)-s\.webp$/.exec(file);
      if (match && files.includes(`${match[1]}-l.webp`)) built.add(`${folder}/${match[1]}`);
    }
  }
  return built;
}

async function sourceImage(photo) {
  if (FIXTURE_MODE) {
    const n = parseInt(photo.sourceHash.slice(0, 6), 16);
    const background = { r: 60 + (n % 150), g: 60 + ((n >> 8) % 150), b: 60 + ((n >> 16) % 150) };
    return sharp({ create: { width: 600, height: 800, channels: 3, background } }).jpeg().toBuffer();
  }
  const response = await fetch(photo.url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`фото ответило ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Две версии WebP. Большую не увеличиваем: исходные снимки канала и так небольшие.
async function encode(photo) {
  const base = sharp(await sourceImage(photo)).rotate();
  const small = await base.clone().resize({ width: WIDTHS.s, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
  const large = await base.clone().resize({ width: WIDTHS.l, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return { small, large };
}

async function save(photo, { small, large }) {
  const folder = join(OUT, String(photo.itemId));
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, `${photo.index}-s.webp`), small);
  await writeFile(join(folder, `${photo.index}-l.webp`), large);
  return small.length + large.length;
}

// Несколько кодировок одновременно, но не больше CONCURRENCY.
async function runPool(items, task) {
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  });
  await Promise.all(runners);
}

async function main() {
  const started = Date.now();
  const messages = await readMessages();
  const photos = collectPhotos(messages);

  const manifestPath = join(STATE, "manifest.json");
  const hadManifest = existsSync(manifestPath);
  const manifest = hadManifest ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
  const plan = planMedia({ photos, manifest, builtKeys: await scanBuilt() });

  const failed = [];
  let bytesWritten = 0;
  await runPool(plan.encode, async (photo) => {
    try {
      bytesWritten += await save(photo, await encode(photo));
      manifest[photo.key] = photo.sourceHash;
    } catch (error) {
      failed.push(`${photo.key}: ${error.message}`);
      delete manifest[photo.key];
    }
  });

  for (const key of plan.remove) {
    const [folder, index] = key.split("/");
    await rm(join(OUT, folder, `${index}-s.webp`), { force: true });
    await rm(join(OUT, folder, `${index}-l.webp`), { force: true });
    delete manifest[key];
  }

  await mkdir(STATE, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1));

  const changed = plan.encode.length > 0 || plan.remove.length > 0 || !hadManifest;
  console.log(
    JSON.stringify(
      {
        channelMessages: messages.length,
        photosInChannel: photos.length,
        kept: plan.keep.length,
        encoded: plan.encode.length - failed.length,
        removed: plan.remove.length,
        failed,
        bytesWritten,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  // Если половина фото не скачалась, это уже проблема канала или сети: пусть сборка упадёт и не выложит полупустую витрину.
  if (failed.length > 0 && failed.length * 2 >= plan.encode.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
