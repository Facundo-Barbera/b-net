import { useEffect, useState } from "react";

/** Path segments after the route's own ("#/projects/b-net/d/x" → ["b-net", "d", "x"]), decoded and following hashchange. */
export function hashSegments(hash: string): string[] {
  const parts = hash.replace(/^#\/?/, "").split("?")[0]!.split("/").filter(Boolean);
  return parts.slice(1).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
}

export function useHashSegments(): string[] {
  const [segs, setSegs] = useState(() => hashSegments(typeof location !== "undefined" ? location.hash : ""));
  useEffect(() => {
    const sync = () => setSegs(hashSegments(location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return segs;
}
