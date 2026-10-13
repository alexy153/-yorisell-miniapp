// Запрет увеличения экрана щипком и двойным касанием. Основной запрет — в мета-теге viewport и в CSS
// (touch-action), здесь — запасной вариант: жесты iPhone и касание двумя пальцами на Android.
(() => {
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );
})();
