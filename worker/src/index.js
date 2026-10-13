// Точка входа Cloudflare Worker: запросы идут в маршрутизатор, расписание обновляет каталог.
import { handleRequest } from "./router.js";
import { syncChannel, DEFAULT_BUDGET } from "./sync.js";
import { fetchText } from "./fetchers.js";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },

  // Расписание из wrangler.toml: обновляем каталог в пределах бюджета запуска.
  // Архив догружается порциями, каждый запуск продолжает с сохранённого места.
  scheduled(event, env, ctx) {
    ctx.waitUntil(syncChannel(env.DB, { fetchText, now: new Date(), budget: DEFAULT_BUDGET }));
  },
};
