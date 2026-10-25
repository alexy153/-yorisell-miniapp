// Фото витрины — статические файлы: web/media/<номер товара>/<номер фото>-s.webp (маленькая версия
// для сетки) и -l.webp (большая, для галереи). Правила имён здесь, по ним же сборка создаёт файлы.
// Статика раздаётся с ближайшего сервера Cloudflare и не запускает Worker, поэтому фото грузятся
// без обращения к базе.
export const WIDTHS = { s: 540, l: 1000 };

export function mediaPath(itemId, index, size) {
  return `/media/${itemId}/${index}-${size}.webp`;
}

// Обе версии одного фото: адреса для карточек (small) и для галереи (large).
export function mediaPair(itemId, index) {
  return { small: mediaPath(itemId, index, "s"), large: mediaPath(itemId, index, "l") };
}
