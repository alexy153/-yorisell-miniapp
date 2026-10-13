// Кнопки «Забронировать» и «Замеры»: открывают личку продавца с готовым текстом.
// В тексте только просьба и ссылка на пост. Ничего не сохраняем и персональных данных не собираем.

export const SELLER_USERNAME = "Alexy153";
export const CHANNEL_USERNAME = "Yorisell";

function postLink(postId) {
  return postId ? `https://t.me/${CHANNEL_USERNAME}/${postId}` : "";
}

function chatUrl(text) {
  return `https://t.me/${SELLER_USERNAME}?text=${encodeURIComponent(text)}`;
}

export function buildBookingText({ postId }) {
  return ["Хочу забронировать:", postLink(postId)].filter(Boolean).join(" ");
}

export function buildBookingUrl(item) {
  return chatUrl(buildBookingText(item));
}

export function buildMeasureText({ postId }) {
  return ["Привет,нужны замеры", postLink(postId)].filter(Boolean).join(" ");
}

export function buildMeasureUrl(item) {
  return chatUrl(buildMeasureText(item));
}
