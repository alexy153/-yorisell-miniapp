// Доказательство: админ-функции не работают без правильной подписи.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../worker/src/router.js";
import { initDataFor, signInitData, TEST_ENV, TEST_ADMIN_ID, TEST_BOT_TOKEN } from "./helpers.js";

const NOW = 1_800_000_000;
const PING = "https://worker.test/api/admin/ping";

function adminCall(authorization, { method = "GET", url = PING } = {}) {
  const headers = authorization === undefined ? {} : { Authorization: authorization };
  return handleRequest(new Request(url, { method, headers }), TEST_ENV, { nowSec: NOW });
}

test("публичный маршрут доступен без подписи", async () => {
  const response = await handleRequest(new Request("https://worker.test/api/health"), TEST_ENV);
  assert.equal(response.status, 200);
});

test("админ без заголовка Authorization: 401", async () => {
  const response = await adminCall(undefined);
  assert.equal(response.status, 401);
});

test("админ с мусором вместо подписи: 403", async () => {
  const response = await adminCall("tma garbage=1&hash=abc");
  assert.equal(response.status, 403);
});

test("админ без схемы tma в заголовке: 401", async () => {
  const response = await adminCall(`Bearer ${initDataFor({ authDate: NOW })}`);
  assert.equal(response.status, 401);
});

test("подпись другого бота: 403", async () => {
  const foreign = initDataFor({ authDate: NOW, botToken: "654321:OTHER-TEST-TOKEN" });
  const response = await adminCall(`tma ${foreign}`);
  assert.equal(response.status, 403);
});

test("подпись верная, но пользователь не админ: 403", async () => {
  const notAdmin = initDataFor({ authDate: NOW, userId: 111 });
  const response = await adminCall(`tma ${notAdmin}`);
  assert.equal(response.status, 403);
});

test("ID админа подменён после подписи: 403", async () => {
  const forged = initDataFor({ authDate: NOW }).replace(String(TEST_ADMIN_ID), "111");
  const response = await adminCall(`tma ${forged}`);
  assert.equal(response.status, 403);
});

test("устаревшая подпись админа: 403", async () => {
  const stale = initDataFor({ authDate: NOW - 2 * 24 * 60 * 60 });
  const response = await adminCall(`tma ${stale}`);
  assert.equal(response.status, 403);
});

test("сервер без ADMIN_ID в настройках никого не пускает в админку: 403", async () => {
  const valid = initDataFor({ authDate: NOW });
  const request = new Request(PING, { headers: { Authorization: `tma ${valid}` } });
  const response = await handleRequest(request, { BOT_TOKEN: TEST_BOT_TOKEN }, { nowSec: NOW });
  assert.equal(response.status, 403);
});

test("верная подпись админа: 200", async () => {
  const valid = initDataFor({ authDate: NOW });
  const response = await adminCall(`tma ${valid}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("админ-маршрут без подписи не раскрывает, что маршрута нет: 401 на любом пути", async () => {
  const response = await adminCall(undefined, { url: "https://worker.test/api/admin/anything" });
  assert.equal(response.status, 401);
});

test("неверная подпись не даёт узнать, что внутри админки", async () => {
  const response = await adminCall("tma hash=00", { url: "https://worker.test/api/admin/anything" });
  assert.equal(response.status, 403);
});

test("сама подпись тестовым токеном проверяется независимо от маршрута", async () => {
  const signed = signInitData({ auth_date: String(NOW), user: JSON.stringify({ id: TEST_ADMIN_ID }) });
  const response = await adminCall(`tma ${signed}`);
  assert.equal(response.status, 200);
});
