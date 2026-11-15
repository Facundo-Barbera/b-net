import type { Handler, ProxyDeps } from "./deps.ts";
import { createInternalHandler } from "./handlers/internal.ts";
import { createPublicHandler } from "./handlers/public.ts";
import { jsonResponse } from "./util.ts";

/** Single Fetch-API handler for the whole proxy: /v1/* (clients), /internal/v1/* (hub), /healthz. */
export function createProxyApp(deps: ProxyDeps): Handler {
  const pub = createPublicHandler(deps);
  const internal = createInternalHandler(deps);
  return async (req) => {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === "/healthz") return jsonResponse({ ok: true, version: deps.version });
      if (pathname.startsWith("/internal/v1/")) return await internal(req);
      if (pathname.startsWith("/v1/")) return await pub(req);
      return jsonResponse({ error: "not found" }, 404);
    } catch (err) {
      deps.logger.log("error", "unhandled error", { path: pathname, err });
      return jsonResponse({ error: "internal error" }, 500);
    }
  };
}
