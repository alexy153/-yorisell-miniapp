// Настоящие загрузчики для работы на Cloudflare: страницы канала и фото из CDN Telegram.

const USER_AGENT = "yorisell-miniapp/1.0 (+https://github.com/alexy153/-yorisell-miniapp)";

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
