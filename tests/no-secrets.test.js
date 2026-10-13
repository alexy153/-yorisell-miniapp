// Токены ботов не должны попадать в файлы репозитория (только tracked и не игнорируемые файлы).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Формат токена BotFather: «число:35 символов».
const BOT_TOKEN_RE = /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/;

test("в файлах репозитория нет токена бота", () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  assert.ok(files.length > 0, "список файлов пуст");
  for (const file of files) {
    const text = readFileSync(new URL(file, `file://${ROOT}/`), "utf8");
    assert.equal(BOT_TOKEN_RE.test(text), false, `похоже на токен бота в ${file}`);
  }
});
