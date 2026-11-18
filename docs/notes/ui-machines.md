# UI · vista Machines

Código en `packages/web/src/views/machines/`. Reemplaza la UI de Beszel y `fleet status`.

## Estructura

| Archivo | Qué hace |
|---|---|
| `MachinesView.tsx` | Estado (máquina seleccionada), composición. Props: `ViewProps` + `initialSelectedId?` opcional. El "ahora" sale de `useNow()` |
| `Topology.tsx` | Mapa SVG (hub al centro, resto en elipse). Debajo de 640 px usa una lista apilada (`matchMedia`, no CSS, para no duplicar nombres accesibles) |
| `SummaryStrip.tsx`, `MachineCard.tsx`, `MachineDetail.tsx` | Resumen, tarjetas, panel de detalle (sparklines + hilos T3) |
| `derive.ts` | Derivaciones propias de la vista (etiquetas, resumen, agrupación de hilos, enlaces del mapa). Formato, tonos, `Meter`, `Sparkline`, `StatusDot`, `Badge`, `Callout`, `KeyValue` y `StatStrip` vienen de `src/lib` y `src/components` (consolidación hecha) |
| `machines.css` | Solo layout y el mapa SVG (prefijo `mv-`); solo variables de `tokens.css` (+ `--mv-*` derivadas con `color-mix`) |

## Decisiones de implementación

- **Tiempo**: la vista lee `useNow()` (regla única del shell, ver `ui-shell.md`); ya no hay prop `now`. Los tests envuelven con `renderAt()` (`test/helpers.tsx`), que usa `snapshotFixture.generatedAt` (= `FIXTURE_NOW`; `FIXTURE_NOW` no sale del índice de `@b-net/core` y importarlo por ruta relativa rompería el `rootDir` de `tsc -b`).
- **Umbrales**: los de `src/lib/thresholds.ts` (warn ≥ 70, danger ≥ 90; antes 75/90 con `>` estricto). Los meters llevan un texto `HIGH`/`CRIT` (por defecto en `Meter`) para no depender solo del color; la temperatura añade "alta"/"crítica" y los anillos del mapa dibujan ▲/■ al pasar el umbral. Temperatura: warn ≥ 75 °C, danger ≥ 85 °C. Latencia peor: warn > 250 ms.
- **Métricas viejas**: más de 5 min desde `metricsAt` se marca `(stale)` y se atenúan los meters.
- **Estados vacíos explícitos**: offline, pausada en Beszel, sin fuente de métricas (con el motivo: Beszel sin conectar / no está en Beszel / sin agente) y "aún sin reportar" tienen textos distintos. Una máquina sin fuente sale `online` con la etiqueta "sin métricas", y un aviso único arriba resume cuántas son y cómo conectarlas. El panel de hilos distingue "T3 no conectado en esta máquina" de "sin hilos", y avisa si la fuente `t3` falla.
- **Sandboxes**: despiertas = active + waiting + idle; dormidas = dormant. Archivadas no cuentan. El mapa y las tarjetas usan `machine.threadCounts`; el panel de detalle usa `snapshot.threads`.
- **Hilos**: agrupados por estado; un subagente se anida bajo su padre solo si ambos están en el mismo grupo; si no, aparece en su grupo con "↳ subagent of …".
- **Resumen**: "Online x/total" cuenta online + degraded (alcanzables); sin métricas/paused/unknown van en el subtexto. "Peor latencia" ignora el hub y máquinas sin medición.
- **Accesibilidad**: cada nodo SVG es `role="button"` con `aria-label` completo (estado, enlace, CPU/RAM, sandboxes) y `aria-pressed`; Enter/Espacio seleccionan; hover y foco resaltan el enlace.

## Tokens

No se tocó `tokens.css`. Variables locales: `--mv-sel-bg` (acento 7 % sobre `--bg-elev`), `--mv-track` (pista de meters/anillos). Si el shell quiere tokens equivalentes (`--surface-selected`, `--track`), basta con reemplazarlas. Cambios visibles de la consolidación: "hace 26 h" ahora es "1d ago" (formatRelative cambia a días a las 24 h), las tasas de red usan base 1024 (`formatBps`) y los meters ok son verdes (antes azules).

## Propuestas (producto)

1. **Selección por defecto**: hoy el panel de detalle empieza vacío. Alternativa: preseleccionar la máquina con más hilos activos. Pendiente de decisión.
2. **Persistir la selección en el hash** (`#/machines/bixku-vps`) para poder compartir el enlace; requiere que el shell lo soporte.
3. **Umbral de "stale"**: 5 min es un valor fijo; con el agente (30 s de pull) se puede bajar a 2 min.
4. **Latencia hub→nodo solamente**: el mapa es una estrella. Si más adelante se mide latencia entre pares, habría que cambiar el layout a grafo completo.
5. **Hilos**: sin acciones (abrir en T3, archivar) en fase 1; solo lectura, como el resto del hub.
6. **Alertas**: los umbrales de CPU/RAM/disco podrían ser configurables por máquina en `config/machines.json` (hoy fijos 70/90, en `lib/thresholds.ts`).
