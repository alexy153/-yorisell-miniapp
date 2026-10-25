import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaPair, mediaPath, WIDTHS } from "../worker/src/media.js";
import { planMedia } from "../scripts/media-plan.mjs";

test("имена файлов: товар, номер фото, маленькая и большая версия", () => {
  assert.equal(mediaPath(170, 0, "s"), "/media/170/0-s.webp");
  assert.deepEqual(mediaPair(170, 2), { small: "/media/170/2-s.webp", large: "/media/170/2-l.webp" });
  assert.equal(WIDTHS.s, 540);
  assert.equal(WIDTHS.l, 1000);
});

test("первая сборка: все фото нужно кодировать", () => {
  const photos = [
    { itemId: 170, index: 0, sourceHash: "a" },
    { itemId: 170, index: 1, sourceHash: "b" },
  ];
  const plan = planMedia({ photos, manifest: {}, builtKeys: new Set() });
  assert.deepEqual(plan.encode.map((photo) => photo.key), ["170/0", "170/1"]);
  assert.equal(plan.keep.length, 0);
  assert.deepEqual(plan.remove, []);
});

test("повторная сборка без изменений ничего не перекодирует", () => {
  const photos = [{ itemId: 170, index: 0, sourceHash: "a" }];
  const plan = planMedia({ photos, manifest: { "170/0": "a" }, builtKeys: new Set(["170/0"]) });
  assert.equal(plan.encode.length, 0);
  assert.equal(plan.keep.length, 1);
});

test("новая ссылка на снимок и потерянный файл перекодируются", () => {
  const photos = [
    { itemId: 170, index: 0, sourceHash: "new" },
    { itemId: 170, index: 1, sourceHash: "b" },
  ];
  const plan = planMedia({ photos, manifest: { "170/0": "old", "170/1": "b" }, builtKeys: new Set() });
  assert.deepEqual(plan.encode.map((photo) => photo.key), ["170/0", "170/1"]);
});

test("товар, которого нет в канале, удаляется из витрины", () => {
  const photos = [{ itemId: 170, index: 0, sourceHash: "a" }];
  const plan = planMedia({
    photos,
    manifest: { "170/0": "a", "175/0": "x" },
    builtKeys: new Set(["170/0", "175/0"]),
  });
  assert.deepEqual(plan.remove, ["175/0"]);
  assert.equal(plan.keep.length, 1);
});

test("одно и то же фото с двух страниц учитывается один раз", () => {
  const photos = [
    { itemId: 170, index: 0, sourceHash: "a" },
    { itemId: 170, index: 0, sourceHash: "a" },
  ];
  assert.equal(planMedia({ photos, manifest: {}, builtKeys: new Set() }).encode.length, 1);
});

test("альбом из трёх фото: все три номера строятся отдельно", () => {
  const photos = [0, 1, 2].map((index) => ({ itemId: 200, index, sourceHash: `h${index}` }));
  const plan = planMedia({ photos, manifest: {}, builtKeys: new Set() });
  assert.deepEqual(plan.encode.map((photo) => photo.key), ["200/0", "200/1", "200/2"]);
});
