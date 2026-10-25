import { test } from "node:test";
import assert from "node:assert/strict";
import { BEATS, T_END } from "../web/intro.js";

const POWER = { soft: 1, light: 2, medium: 3, rigid: 4, heavy: 5 };
const levels = BEATS.map(([, kind]) => POWER[kind]);
const WORD_FORMED = 1.85; // к этому моменту последние осколки встают на место и слово сложено

test("вибрация заставки: только стили Telegram, ровные удары каждые 0,1 с", () => {
  assert.ok(BEATS.every(([, kind]) => kind in POWER));
  const gaps = BEATS.slice(1).map(([t], i) => t - BEATS[i][0]);
  assert.ok(gaps.every((gap) => Math.abs(gap - 0.1) < 1e-6), "удары идут с постоянным шагом");
  assert.equal(BEATS[0][0], 0);
});

test("вибрация заставки: недолгая и уходит к моменту, когда слово сложилось", () => {
  const last = BEATS.at(-1)[0];
  assert.ok(last <= WORD_FORMED, `последний удар на ${last} с, слово складывается около ${WORD_FORMED} с`);
  assert.ok(last >= WORD_FORMED - 0.2, "вибрация держится почти до самого складывания слова, а не обрывается заранее");
  assert.ok(last < T_END, "и конечно раньше конца заставки: на разлёт слова вибрации нет");
  assert.ok(last <= 2, "вся вибрация короче двух секунд");
});

test("вибрация заставки: сила растёт до самой сильной и спадает до самой слабой, одной «горкой»", () => {
  assert.equal(levels[0], 1, "начинается с самого слабого");
  assert.equal(levels.at(-1), 1, "заканчивается самым слабым");
  const from = levels.indexOf(5);
  const to = levels.lastIndexOf(5);
  assert.ok(from > 0 && to > from && to < levels.length - 1, "самый сильный удар есть и не на краю");
  assert.ok(levels.slice(from, to + 1).every((v) => v === 5), "самые сильные удары идут подряд");
  assert.ok(levels.slice(0, from + 1).every((v, i, a) => i === 0 || v >= a[i - 1]), "до пика сила не падает");
  assert.ok(levels.slice(to).every((v, i, a) => i === 0 || v <= a[i - 1]), "после пика сила не растёт");
  assert.ok(levels.every((v, i) => i === 0 || Math.abs(v - levels[i - 1]) <= 1), "без скачков больше чем на ступень");
});
