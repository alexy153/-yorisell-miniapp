// Маршруты сервера. Админ-маршруты проверяются гардом раньше любой логики.
import { requireAdmin } from "./auth.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleRequest(request, env, options = {}) {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/api/health") {
    return json({ ok: true });
  }

  if (pathname.startsWith("/api/admin/")) {
    const guard = await requireAdmin(request, env, options);
    if (!guard.ok) return json({ error: guard.error }, guard.status);
    if (request.method === "GET" && pathname === "/api/admin/ping") {
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  return json({ error: "not found" }, 404);
}
