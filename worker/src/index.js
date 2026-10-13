// Точка входа Cloudflare Worker: все запросы передаются в маршрутизатор.
import { handleRequest } from "./router.js";

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
