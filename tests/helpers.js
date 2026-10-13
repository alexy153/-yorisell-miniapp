// Общие помощники тестов. Токен здесь тестовый: он не настоящий и нужен только для проверки подписи.
import { createHmac } from "node:crypto";

export const TEST_BOT_TOKEN = "123456:TEST-TOKEN-not-real";
export const TEST_ADMIN_ID = 424242;

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

export const TEST_ENV = { BOT_TOKEN: TEST_BOT_TOKEN, ADMIN_ID: String(TEST_ADMIN_ID) };
