import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyInitData } from "../worker/src/auth.js";
import { initDataFor, signInitData, TEST_BOT_TOKEN, TEST_ADMIN_ID } from "./helpers.js";

const NOW = 1_800_000_000;

test("верная подпись: данные принимаются и видно пользователя", async () => {
  const result = await verifyInitData(initDataFor({ authDate: NOW }), TEST_BOT_TOKEN, { nowSec: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, TEST_ADMIN_ID);
});

test("подмена user.id после подписи: отказ", async () => {
  const forged = initDataFor({ authDate: NOW }).replace(String(TEST_ADMIN_ID), "999999");
  const result = await verifyInitData(forged, TEST_BOT_TOKEN, { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad-signature");
});

test("подпись другого бота: отказ", async () => {
  const otherBot = "654321:OTHER-TEST-TOKEN";
  const result = await verifyInitData(initDataFor({ authDate: NOW, botToken: otherBot }), TEST_BOT_TOKEN, {
    nowSec: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad-signature");
});

test("устаревшие данные (старше суток): отказ", async () => {
  const twoDaysAgo = NOW - 2 * 24 * 60 * 60;
  const result = await verifyInitData(initDataFor({ authDate: twoDaysAgo }), TEST_BOT_TOKEN, { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
});

test("дата из будущего: отказ", async () => {
  const result = await verifyInitData(initDataFor({ authDate: NOW + 3600 }), TEST_BOT_TOKEN, { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "from-future");
});

test("без поля hash: отказ", async () => {
  const withoutHash = initDataFor({ authDate: NOW }).replace(/&?hash=[0-9a-f]+/, "");
  const result = await verifyInitData(withoutHash, TEST_BOT_TOKEN, { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-hash");
});

test("подпись без пользователя: отказ", async () => {
  const noUser = signInitData({ auth_date: String(NOW), query_id: "X" });
  const result = await verifyInitData(noUser, TEST_BOT_TOKEN, { nowSec: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-user");
});

test("пустые данные и пустой токен: отказ", async () => {
  assert.equal((await verifyInitData("", TEST_BOT_TOKEN, { nowSec: NOW })).ok, false);
  assert.equal((await verifyInitData(initDataFor({ authDate: NOW }), "", { nowSec: NOW })).ok, false);
});
