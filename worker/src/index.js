// Точка входа Cloudflare Worker: запросы идут в маршрутизатор, расписание обновляет каталог.
import { handleRequest } from "./router.js";
import { syncChannel } from "./sync.js";
import { fetchText, fetchBytes } from "./fetchers.js";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },

  // Расписание из wrangler.toml: обновляем каталог из канала порциями.
  scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncChannel(env.DB, { fetchText, fetchBytes, now: new Date(), pageBudget: 6, photoBudget: 25 }),
    );
  },
};
