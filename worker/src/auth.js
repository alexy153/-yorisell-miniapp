// Проверка данных запуска Telegram Mini App (initData).
// Подпись проверяет сервер токеном бота. Данным из браузера без проверки не доверяем.

const encoder = new TextEncoder();
const MAX_AGE_SEC = 24 * 60 * 60;

async function hmacSha256(keyBytes, messageBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, messageBytes));
}

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Сравнение за постоянное время, чтобы подпись нельзя было подобрать по времени ответа.
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Возвращает { ok: true, user, authDate } либо { ok: false, reason }.
export async function verifyInitData(initData, botToken, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!initData || !botToken) return { ok: false, reason: "missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no-hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  // secret_key = HMAC_SHA256(key = "WebAppData", message = токен бота)
  const secretKey = await hmacSha256(encoder.encode("WebAppData"), encoder.encode(botToken));
  const expected = toHex(await hmacSha256(secretKey, encoder.encode(dataCheckString)));
  if (!sameString(expected, hash.toLowerCase())) return { ok: false, reason: "bad-signature" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return { ok: false, reason: "no-auth-date" };
  if (nowSec - authDate > MAX_AGE_SEC) return { ok: false, reason: "expired" };
  if (authDate - nowSec > 60) return { ok: false, reason: "from-future" };

  let user = null;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    user = null;
  }
  if (!user || typeof user.id !== "number") return { ok: false, reason: "no-user" };
  return { ok: true, user, authDate };
}

// Гард админ-функций: без подписи — 401, с неверной подписью или чужим ID — 403.
export async function requireAdmin(request, env, options) {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^tma\s+(.+)$/.exec(header);
  if (!match) return { ok: false, status: 401, error: "unauthorized" };
  if (!env.ADMIN_ID) return { ok: false, status: 403, error: "forbidden" };

  const result = await verifyInitData(match[1], env.BOT_TOKEN, options);
  if (!result.ok) return { ok: false, status: 403, error: "forbidden" };
  if (String(result.user.id) !== String(env.ADMIN_ID)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, user: result.user };
}
