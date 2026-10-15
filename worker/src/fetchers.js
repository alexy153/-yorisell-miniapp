// Настоящие загрузчики для работы на Cloudflare: страницы канала и фото из CDN Telegram.

const USER_AGENT = "yorisell-miniapp/1.0 (+https://github.com/alexy153/-yorisell-miniapp)";

// Фото берём только с CDN Telegram: адрес в базе не должен вести куда угодно.
export function isChannelPhotoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" && (url.hostname === "telesco.pe" || url.hostname.endsWith(".telesco.pe"));
}

export async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

export async function fetchBytes(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/jpeg",
  };
}
