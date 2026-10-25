// Что пересобрать при запуске сборки фото. Чистая функция: без сети и без диска, поэтому её проверяют тесты.
//   photos:    фото из канала: { itemId, index, sourceHash } — хэш ссылки на снимок
//   manifest:  что собрано в прошлый раз: { "<товар>/<номер>": "<хэш ссылки>" }
//   builtKeys: ключи, для которых оба файла (маленький и большой) уже лежат на диске
// Возвращает: что кодировать заново, что оставить как есть и что удалить из витрины.
export function planMedia({ photos, manifest, builtKeys }) {
  const wanted = new Set();
  const encode = [];
  const keep = [];
  for (const photo of photos) {
    const key = `${photo.itemId}/${photo.index}`;
    if (wanted.has(key)) continue; // одно и то же фото могло попасть с двух страниц
    wanted.add(key);
    const unchanged = manifest[key] === photo.sourceHash && builtKeys.has(key);
    (unchanged ? keep : encode).push({ ...photo, key });
  }
  const known = new Set([...builtKeys, ...Object.keys(manifest)]);
  const remove = [...known].filter((key) => !wanted.has(key));
  return { encode, keep, remove };
}
