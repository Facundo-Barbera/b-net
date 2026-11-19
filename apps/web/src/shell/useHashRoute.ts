import { useEffect, useState } from "react";
import { routes, type RouteDef } from "../routes.tsx";

const DEFAULT_ROUTE = routes[0]!;

/** Match a location hash to a route ("#/proxy", "#/proxy/x", "#/proxy?y"); unknown/empty → the first route (work). */
export function resolveRoute(hash: string): RouteDef {
  const path = hash.split("?")[0]!;
  return routes.find((r) => path === r.path || path.startsWith(`${r.path}/`)) ?? DEFAULT_ROUTE;
}

/** Current route from `location.hash`, following `hashchange`. Rewrites unknown hashes to the default. */
export function useHashRoute(): RouteDef {
  const [route, setRoute] = useState<RouteDef>(() =>
    resolveRoute(typeof location !== "undefined" ? location.hash : ""),
  );

  useEffect(() => {
    const sync = () => {
      const next = resolveRoute(location.hash);
      setRoute(next);
      const h = location.hash.split("?")[0]!;
      if (h !== next.path && !h.startsWith(`${next.path}/`)) {
        try {
          history.replaceState(null, "", next.path);
        } catch {
          /* ignore: rendering already uses the default route */
        }
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return route;
}
