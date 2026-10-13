// Ссылка «Забронировать»: открывает личку продавца с готовым текстом.
// В тексте только просьба и ссылка на пост. Ничего не сохраняем и персональных данных не собираем.

export const SELLER_USERNAME = "Alexy153";
export const CHANNEL_USERNAME = "Yorisell";

export function buildBookingText({ postId }) {
  const post = postId ? `https://t.me/${CHANNEL_USERNAME}/${postId}` : "";
  return ["Хочу забронировать:", post].filter(Boolean).join(" ");
}

export function buildBookingUrl(item) {
  return `https://t.me/${SELLER_USERNAME}?text=${encodeURIComponent(buildBookingText(item))}`;
}
