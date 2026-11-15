import { useEffect, useState } from "react";
import { routes } from "../routes.tsx";
import { useSnapshot } from "../data/useSnapshot.ts";

/** STUB shell: owned by the "UI shell" child (sidebar, nav, theme toggle, layout). */
export function App() {
  const { snapshot, error } = useSnapshot();
  const [hash, setHash] = useState(() => (typeof location !== "undefined" ? location.hash : "") || "#/machines");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/machines");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const route = routes.find((r) => r.path === hash) ?? routes[0]!;
  const View = route.component;
  return (
    <div className="app">
      <nav>{routes.map((r) => <a key={r.id} href={r.path}>{r.label}</a>)}</nav>
      <main>{error ? <p role="alert">{error}</p> : snapshot ? <View snapshot={snapshot} /> : <p>Cargando…</p>}</main>
    </div>
  );
}
