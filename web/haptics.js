// Вибрация телефона. В Telegram — его отклик (soft < light < medium < rigid < heavy), в обычном браузере — вибрация
// Android (она разрешена только после первого касания страницы; на iPhone вне Telegram её нет).

const tg = typeof window === "undefined" ? undefined : window.Telegram?.WebApp;
// Telegram-скрипт загружается и в обычном браузере, поэтому проверяем, что приложение открыто внутри Telegram.
const inTelegram = Boolean(tg && tg.platform && tg.platform !== "unknown");
const VIBRATE_MS = { soft: 14, light: 18, medium: 26, rigid: 32, heavy: 45 };

export function haptic(kind) {
  try {
    if (inTelegram) tg.HapticFeedback?.impactOccurred(kind);
    else if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(VIBRATE_MS[kind] ?? 18);
  } catch {
    /* вибрации в этой версии нет */
  }
}

// Нажатие на любую кнопку, ссылку, переключатель или список даёт отклик — без списка исключений, поэтому новые кнопки
// получают его сами. style(кнопка) возвращает силу отклика, null — не вибрировать; find(элемент) находит нестандартные
// кликабельные места (например, подложку за окном). Слушатель стоит в «перехвате»: срабатывает раньше обработчиков
// страницы, даже если они остановят событие.
const CONTROL =
  'button, a[href], select, summary, input[type="checkbox"], input[type="radio"], input[type="submit"], [role="button"], [role="switch"], [role="tab"]';
const DISABLED = ':disabled, [aria-disabled="true"]';

export function installTapFeedback({ style = () => "light", find = () => null } = {}) {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (typeof target?.closest !== "function") return;
      const control = target.closest(CONTROL) ?? find(target);
      if (!control || control.matches(DISABLED)) return;
      const kind = style(control);
      if (kind) haptic(kind);
    },
    true,
  );
}
