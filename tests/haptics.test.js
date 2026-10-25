import { test } from "node:test";
import assert from "node:assert/strict";

// web/haptics.js читает window.Telegram при загрузке, поэтому каждый сценарий берёт свежую копию модуля.
let copy = 0;
async function load({ telegram, navigator = {} }) {
  const listeners = [];
  globalThis.window = { Telegram: telegram };
  globalThis.document = { addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }) };
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true, writable: true });
  const module = await import(`../web/haptics.js?copy=${++copy}`);
  return { ...module, listeners };
}

function telegramStub({ failing = false } = {}) {
  const calls = [];
  return {
    calls,
    WebApp: {
      platform: "ios",
      HapticFeedback: {
        impactOccurred: (kind) => {
          if (failing) throw new Error("не поддерживается");
          calls.push(kind);
        },
      },
    },
  };
}

// Похоже на элемент страницы: closest отдаёт сам элемент, если это кнопка; matches отвечает про «недоступна».
const element = ({ control = true, disabled = false } = {}) => ({
  closest() {
    return control ? this : null;
  },
  matches() {
    return disabled;
  },
});

test("в Telegram вибрация идёт через его отклик с нужной силой", async () => {
  const tg = telegramStub();
  const { haptic } = await load({ telegram: { WebApp: tg.WebApp } });
  for (const kind of ["soft", "light", "medium", "rigid", "heavy"]) haptic(kind);
  assert.deepEqual(tg.calls, ["soft", "light", "medium", "rigid", "heavy"]);
});

test("если отклик Telegram недоступен, ошибка наружу не выходит", async () => {
  const tg = telegramStub({ failing: true });
  const { haptic } = await load({ telegram: { WebApp: tg.WebApp } });
  assert.doesNotThrow(() => haptic("heavy"));
});

test("в обычном браузере вибрация Android включается только после первого касания страницы", async () => {
  const vibrations = [];
  const navigator = { userActivation: { hasBeenActive: false }, vibrate: (ms) => vibrations.push(ms) };
  const { haptic } = await load({ telegram: undefined, navigator });
  haptic("heavy");
  assert.deepEqual(vibrations, [], "без касания браузер вибрацию запрещает");
  navigator.userActivation.hasBeenActive = true;
  haptic("heavy");
  haptic("soft");
  assert.deepEqual(vibrations, [45, 14]);
});

test("Telegram-скрипт в обычном браузере (platform unknown) не считается Telegram", async () => {
  const tg = telegramStub();
  tg.WebApp.platform = "unknown";
  const vibrations = [];
  const navigator = { userActivation: { hasBeenActive: true }, vibrate: (ms) => vibrations.push(ms) };
  const { haptic } = await load({ telegram: { WebApp: tg.WebApp }, navigator });
  haptic("medium");
  assert.deepEqual(tg.calls, []);
  assert.deepEqual(vibrations, [26]);
});

test("любое нажатие на кнопку даёт отклик, слушатель стоит в перехвате и ставится один раз", async () => {
  const tg = telegramStub();
  const { installTapFeedback, listeners } = await load({ telegram: { WebApp: tg.WebApp } });
  installTapFeedback();
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, "click");
  assert.equal(listeners[0].capture, true, "перехват нужен, чтобы отклик не зависел от обработчиков страницы");
  listeners[0].handler({ target: element() });
  assert.deepEqual(tg.calls, ["light"], "без своих правил — лёгкий отклик");
});

test("сила отклика берётся из правил, null отключает его, недоступные кнопки молчат", async () => {
  const tg = telegramStub();
  const { installTapFeedback, listeners } = await load({ telegram: { WebApp: tg.WebApp } });
  installTapFeedback({ style: (control) => (control.strong ? "medium" : control.quiet ? null : "light") });
  const press = (props) => listeners[0].handler({ target: { ...element(), ...props, closest() { return this; } } });
  press({ strong: true });
  press({});
  press({ quiet: true });
  press({ disabled: true, matches: () => true });
  assert.deepEqual(tg.calls, ["medium", "light"]);
});

test("нестандартные кликабельные места находятся через find, а не-кнопки отклика не дают", async () => {
  const tg = telegramStub();
  const { installTapFeedback, listeners } = await load({ telegram: { WebApp: tg.WebApp } });
  const backdrop = { matches: () => false };
  installTapFeedback({ find: (target) => (target.zoom ? backdrop : null) });
  listeners[0].handler({ target: element({ control: false }) });
  assert.deepEqual(tg.calls, [], "обычный текст и пустое место не вибрируют");
  listeners[0].handler({ target: { ...element({ control: false }), zoom: true } });
  assert.deepEqual(tg.calls, ["light"], "подложка просмотра фото вибрирует");
  listeners[0].handler({ target: null });
  listeners[0].handler({ target: {} });
  assert.deepEqual(tg.calls, ["light"], "события без элемента игнорируются");
});
