import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SearchIcon } from "../components/icons.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import { filterPalette, PALETTE_GROUPS, type PaletteEntry } from "./palette.ts";

export interface CommandPaletteProps {
  open: boolean;
  entries: readonly PaletteEntry[];
  onClose: () => void;
}

/** Hash routes stay in the app, https leaves in a new tab, anything else (t3-thread://) hands off to its app. */
export function openEntry(href: string): void {
  if (href.startsWith("#")) location.hash = href;
  else if (/^https?:/.test(href)) window.open(href, "_blank", "noopener,noreferrer");
  else location.href = href;
}

/**
 * ⌘K / Ctrl K palette: type to filter views, waiting items, running threads and projects; arrows move,
 * Enter opens, Escape closes. Follows the ARIA combobox + listbox pattern so the input keeps focus while the
 * active option is announced. Focus returns to whatever had it before opening.
 */
export function CommandPalette({ open, entries, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreRef = useRef<Element | null>(null);
  const uid = useId();
  const results = useMemo(() => filterPalette(entries, query), [entries, query]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    return () => {
      const prev = restoreRef.current;
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, [open]);

  // Keep the highlighted option visible while arrowing through a long list (jsdom has no scrollIntoView).
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active, results]);

  if (!open) return null;

  const pick = (e: PaletteEntry | undefined) => {
    if (!e) return;
    onClose();
    openEntry(e.href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => (results.length ? (a + 1) % results.length : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
        break;
      case "Enter":
        e.preventDefault();
        pick(results[active]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Tab":
        // The input is the only stop inside the modal; keep focus from escaping behind the backdrop.
        e.preventDefault();
        break;
    }
  };

  const optionId = (i: number) => `${uid}-opt-${i}`;

  return (
    <div className="sh-palette" data-testid="command-palette">
      <div className="sh-palette__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sh-palette__panel" role="dialog" aria-modal="true" aria-label="Buscar o ir a">
        <div className="sh-palette__search">
          <SearchIcon className="sh-palette__glass" />
          <input
            ref={inputRef}
            className="sh-palette__input"
            type="text"
            role="combobox"
            aria-label="Buscar vistas, trabajo y proyectos"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            placeholder="Buscar vistas, trabajo y proyectos…"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="sh-palette__esc">Esc</kbd>
        </div>
        <ul ref={listRef} id={`${uid}-list`} className="sh-palette__list" role="listbox" aria-label="Resultados">
          {PALETTE_GROUPS.map((g) => {
            const items = results.filter((r) => r.group === g);
            if (items.length === 0) return null;
            return (
              <li key={g} role="presentation">
                <p className="sh-palette__group ui-label" aria-hidden="true">{g}</p>
                <ul role="group" aria-label={g}>
                  {items.map((e) => {
                    const i = results.indexOf(e);
                    const selected = i === active;
                    return (
                      <li
                        key={e.id}
                        id={optionId(i)}
                        role="option"
                        aria-selected={selected}
                        className="sh-palette__opt"
                        data-testid={`palette-${e.id}`}
                        onMouseMove={() => !selected && setActive(i)}
                        onClick={() => pick(e)}
                      >
                        {e.tone ? <StatusDot tone={e.tone} /> : <span className="sh-palette__bullet" aria-hidden="true" />}
                        <span className="sh-palette__label">{e.label}</span>
                        {e.hint && <span className="sh-palette__hint">{e.hint}</span>}
                        {e.shortcut && <kbd className="sh-palette__kbd">{e.shortcut}</kbd>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
        {results.length === 0 && (
          <p className="sh-palette__empty" role="status">
            Nada coincide con «{query}».
          </p>
        )}
        <footer className="sh-palette__foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> moverse</span>
          <span><kbd>↵</kbd> abrir</span>
          <span><kbd>Esc</kbd> cerrar</span>
        </footer>
      </div>
    </div>
  );
}
