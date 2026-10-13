// Ссылка «Забронировать»: открывает личку продавца с готовым текстом.
// Ничего не сохраняем и персональных данных не собираем.

export const SELLER_USERNAME = "Alexy153";
export const CHANNEL_USERNAME = "Yorisell";
const MAX_TEXT_LENGTH = 4096;

// 19930 -> "19 930 ₽"
export function formatRub(amount) {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
}

export function buildBookingText({ title, size, priceRub, postId }) {
  const head = [title, size && `размер ${size}`, formatRub(priceRub)].filter(Boolean).join(", ");
  const lines = [`Хочу забронировать: ${head}`];
  if (postId) lines.push(`https://t.me/${CHANNEL_USERNAME}/${postId}`);
  return Array.from(lines.join("\n")).slice(0, MAX_TEXT_LENGTH).join("");
}

export function buildBookingUrl(item) {
  return `https://t.me/${SELLER_USERNAME}?text=${encodeURIComponent(buildBookingText(item))}`;
}
