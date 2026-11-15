# UI · vista Machines

Código en `packages/web/src/views/machines/`. Reemplaza la UI de Beszel y `fleet status`.

## Estructura

| Archivo | Qué hace |
|---|---|
| `MachinesView.tsx` | Estado (máquina seleccionada), composición. Props: `ViewProps` + `now?` y `initialSelectedId?` opcionales |
| `Topology.tsx` | Mapa SVG (hub al centro, resto en elipse). Debajo de 640 px usa una lista apilada (`matchMedia`, no CSS, para no duplicar nombres accesibles) |
| `SummaryStrip.tsx`, `MachineCard.tsx`, `MachineDetail.tsx` | Resumen, tarjetas, panel de detalle (sparklines + hilos T3) |
| `derive.ts`, `format.ts`, `parts.tsx` | Helpers locales a la vista (estado/tono, resumen, agrupación de hilos, formateo, Meter/Sparkline). Pueden consolidarse en `src/components` y `src/lib` más adelante |
| `machines.css` | Estilos con prefijo `mv-`; solo variables de `tokens.css` (+ `--mv-*` derivadas con `color-mix`) |

## Decisiones de implementación

- **Tiempo inyectable**: todo texto relativo usa `now` (número, ISO o `Date`; por defecto `Date.now()`). Los tests usan `snapshotFixture.generatedAt` (= `FIXTURE_NOW`; `FIXTURE_NOW` no sale del índice de `@bixku/core` y importarlo por ruta relativa rompería el `rootDir` de `tsc -b`).
- **Umbrales**: meters warn > 75, danger > 90. Además llevan un texto `HIGH`/`CRIT` para no depender solo del color. Temperatura: warn > 75 °C, danger > 85 °C.
- **Métricas viejas**: más de 5 min desde `metricsAt` se marca `(stale)` y se atenúan los meters.
- **Estados vacíos explícitos**: offline, paused, sin fuente de métricas y "aún sin reportar" tienen textos distintos. Si falla la fuente `t3` de la máquina (según `snapshot.sources`) el panel de hilos avisa que la lista puede estar desactualizada.
- **Sandboxes**: despiertas = active + waiting + idle; dormidas = dormant. Archivadas no cuentan. El mapa y las tarjetas usan `machine.threadCounts`; el panel de detalle usa `snapshot.threads`.
- **Hilos**: agrupados por estado; un subagente se anida bajo su padre solo si ambos están en el mismo grupo; si no, aparece en su grupo con "↳ subagent of …".
- **Resumen**: "Online x/total" cuenta online + degraded (alcanzables); paused/unknown van en el subtexto. "Worst latency" ignora el hub y máquinas sin medición.
- **Accesibilidad**: cada nodo SVG es `role="button"` con `aria-label` completo (estado, enlace, CPU/RAM, sandboxes) y `aria-pressed`; Enter/Espacio seleccionan; hover y foco resaltan el enlace.

## Tokens

No se tocó `tokens.css`. Variables locales: `--mv-glow`, `--mv-sel-bg` (acento 7 % sobre `--bg-elev`), `--mv-track` (pista de meters/anillos). Si el shell quiere tokens equivalentes (`--surface-selected`, `--track`), basta con reemplazarlas.

## Propuestas (producto)

1. **Selección por defecto**: hoy el panel de detalle empieza vacío. Alternativa: preseleccionar la máquina con más hilos activos. Pendiente de decisión.
2. **Persistir la selección en el hash** (`#/machines/bixku-vps`) para poder compartir el enlace; requiere que el shell lo soporte.
3. **Umbral de "stale"**: 5 min es un valor fijo; con el agente (30 s de pull) se puede bajar a 2 min.
4. **Latencia hub→nodo solamente**: el mapa es una estrella. Si más adelante se mide latencia entre pares, habría que cambiar el layout a grafo completo.
5. **Hilos**: sin acciones (abrir en T3, archivar) en fase 1; solo lectura, como el resto del hub.
6. **Alertas**: los umbrales de CPU/RAM/disco podrían ser configurables por máquina en `config/machines.json` (hoy fijos 75/90).
