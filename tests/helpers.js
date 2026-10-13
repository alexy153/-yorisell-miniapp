// Общие помощники тестов. Токен здесь тестовый: он не настоящий и нужен только для проверки подписи.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { openDatabase } from "../scripts/d1-sqlite.js";

export const TEST_BOT_TOKEN = "123456:TEST-TOKEN-not-real";
export const TEST_ADMIN_ID = 424242;
export const TEST_ENV = { BOT_TOKEN: TEST_BOT_TOKEN, ADMIN_ID: String(TEST_ADMIN_ID) };

// Подпись так же, как у Telegram: ключ = HMAC-SHA256("WebAppData", токен),
// затем HMAC-SHA256(ключ, строка проверки). Здесь другая реализация (node:crypto),
// поэтому совпадение с серверной проверкой что-то доказывает.
export function signInitData(fields, botToken = TEST_BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secretKey).update(dataCheckString).digest("hex"));
  return params.toString();
}

export function initDataFor({
  userId = TEST_ADMIN_ID,
  authDate = Math.floor(Date.now() / 1000),
  botToken = TEST_BOT_TOKEN,
} = {}) {
  return signInitData(
    {
      auth_date: String(authDate),
      query_id: "TEST-QUERY",
      user: JSON.stringify({ id: userId, first_name: "Test" }),
    },
    botToken,
  );
}

export function adminHeaders(userId = TEST_ADMIN_ID) {
  return { Authorization: `tma ${initDataFor({ userId })}` };
}

// Свежая база с миграциями и настройками тестового бота.
export function createTestEnv(extra = {}) {
  return { DB: openDatabase(), ...TEST_ENV, ...extra };
}

const FIXTURES = new URL("./fixtures/", import.meta.url);

export function fixtureText(name) {
  return readFileSync(new URL(name, FIXTURES), "utf8");
}

// Загрузчики без сети: страницы канала берём из сохранённых фикстур, фото — заглушки.
export function fixtureFetchers({ pages = {} } = {}) {
  const map = new Map([
    ["https://t.me/s/Yorisell", fixtureText("channel-latest.html")],
    ["https://t.me/s/Yorisell?before=170", fixtureText("channel-older.html")],
    ...Object.entries(pages),
  ]);
  const pageRequests = [];
  const photoRequests = [];
  return {
    pageRequests,
    photoRequests,
    fetchText: async (url) => {
      pageRequests.push(url);
      return map.get(url) ?? "<html></html>";
    },
    fetchBytes: async (url) => {
      photoRequests.push(url);
      return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" };
    },
  };
}
