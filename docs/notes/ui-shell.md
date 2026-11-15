# UI shell: notas y propuestas

Área: `packages/web/src/{shell,components,lib,styles}`. Para los hijos que escriben las vistas.

## Qué hay

- **Shell** (`shell/`): `App` (datos + ruta hash + tema) → `Shell` (skip link, `Sidebar`, `Topbar`, `<main id="main-content">`). `App` acepta `mode` para tests (`<App mode="fixture" />`).
- **Responsive**: ≥900 px sidebar completa (232 px) · 600–899 px riel de iconos (56 px, etiquetas solo para lectores de pantalla) · <600 px cajón con botón de menú (Escape, backdrop y navegar lo cierran).
- **Tema**: `system | dark | light` en `localStorage["bixku-hub.theme"]` (todo en try/catch), escribe `data-theme` en `<html>`. `index.html` aplica el tema guardado antes del primer paint.
- **Reloj**: `NowProvider`/`useNow()`. En modo fixture "ahora" = `snapshot.generatedAt` (el fixture se ve vivo y los tiempos relativos son deterministas); en modo live es el reloj real con tick cada 30 s. **Regla única para las vistas, ver Convenciones.**
- **Badges del nav** (`shell/badges.ts`, `deriveNavBadges`): Machines = offline (si no hay, degraded) · Subscriptions = cuentas en cooldown/error · Proxy = errores de la última hora · Secrets = expiring/expired/invalid.

## Primitivas (`import { … } from "../../components/index.ts"`)

| Nombre | API |
|---|---|
| `Card` / `Panel` | `title?, subtitle?, actions?, flush?, headingLevel?=2, as?: "section"\|"article", bodyClassName?` + props de `<section>` |
| `StatusDot` | `tone?, label?, pulse?` (sin `label` es decorativo) |
| `Badge` | `tone?, variant?: "soft"\|"outline", dot?` + props de `<span>` |
| `Tag` | chip mono discreto para metadatos (versión, origen, prioridad) |
| `Meter` | `value (0–100\|null), warnAt?, dangerAt?` (por defecto `lib/thresholds`), `tone?, label?, ariaLabel?, showValue?, valueText?, flag? (HIGH/CRIT), detail?` (`role="meter"`, `aria-valuenow` redondeado) |
| `Sparkline` | `values, width?=96, height?=24, min?, max?, tone?=info, series? (1–4 → --chart-N), stretch?, refLine?, label?` |
| `Stat` / `StatStrip` | `Stat`: `label, value, unit?, hint?, tone?` (`<dl>`; valor en mono). `StatStrip`: fila de tiles unidos (KPI), grupo si lleva `aria-label` |
| `RelativeTime` | `value, now?, format?, fallback?` → `<time>` con tooltip UTC; `format(value, now)` permite texto preciso o localizado |
| `EmptyState` | `title, description?, icon?, action?, role?, compact?, children?` + props de `<div>` |
| `Table` | `dense?, wrapClassName?` + props de `<table>`; un único estilo de tabla con scroll horizontal propio. Celdas: `.u-right`, `.u-nowrap`, `.u-muted`, `.u-faint`, `.u-strong`, `.num` |
| `Callout` | `tone?, icon?` + props de `<div>`; aviso con barra de tono (`role` lo pone quien lo usa) |
| `KeyValue` / `KV` | rejilla `<dl>` de pares etiqueta/valor (valor en mono, `tone?`) |
| `PageHeader` | `title, subtitle?, titleId?`: el único `<h1>` de cada vista |
| tonos | `Tone`, `meterTone`, `toneForMachineStatus`, `toneForPoolState`, `toneForSecretStatus`, `toneForThreadState`, `toneForServiceStatus` |
| iconos | `MachinesIcon`, `SubscriptionsIcon`, `ProxyIcon`, `SecretsIcon`, `SunIcon`, `MoonIcon`, … (SVG inline, `1em`) |

Formatters en `lib/format.ts`: `formatBytes`, `formatBps` (**bytes**/s), `formatPercent`, `formatTokens`, `formatUsd`, `formatUsdHeadline`, `formatMoney`, `formatInt`, `formatDuration` (segundos), `formatMs` ("820 ms"), `formatUsedOfGb`, `formatRelative(t, now?)` (compacto, una unidad: "5m ago"), `formatSpan` / `formatCountdown` / `formatRelativeSpan(t, now, { seconds?, lang?: "en"\|"es" })` (preciso, dos unidades: "2h 10m", "hace 7h 0m"), `formatAbsolute`. Todos devuelven `—` para null/NaN. Umbrales de visualización en `lib/thresholds.ts`.

Utilidades CSS: `.ui-label` (etiqueta pequeña en mayúsculas), `.num` (mono tabular), `.ui-grid` (grid auto-fill de tarjetas), `.ui-view` (raíz de vista: columna con `--sp-5`), `.u-muted/.u-faint/.u-strong/.u-accent/.u-danger/.u-nowrap/.u-right`, `.sr-only`, clases `tone-*` (fijan `--tone`). Tokens nuevos: `--accent-fg`, `--overlay`, `--sidebar-w`, `--rail-w`, `--topbar-h`, `--focus-ring`, `--ease`, escala de espaciado `--sp-1…6` (4/8/12/16/20/24 px). Los nombres existentes no cambiaron.

## Convenciones para las vistas

- El título de página lo muestra la barra superior (`data-testid="page-title"`, **no** es un heading). Cada vista conserva su propio `<h1>`/`data-testid="view-<id>"`; las `Card` usan `<h2>`.
- Los colores solo vía variables; los números en `.num`.
- Sin scroll horizontal a 375 px: tablas anchas dentro de un contenedor con `overflow-x: auto`.
- Tests de vistas: `renderAt(<View snapshot={…} />, now?)` para tiempos deterministas.

### Consolidación (reglas vigentes)

- **"Ahora"**: una sola regla. Las vistas **no** reciben `now`; llaman `useNow()` (o usan `RelativeTime`, que lo lee solo). Fixture → `snapshot.generatedAt` (determinista); live → `Date.now()` con tick de 30 s. Sin `NowProvider` (p. ej. un test suelto) `useNow()` cae a un reloj propio. Los tests fijan el tiempo con `renderAt(ui, now?)` de `test/helpers.tsx` (por defecto `snapshotFixture.generatedAt`).
- **Umbrales**: `lib/thresholds.ts` es la única fuente: `USAGE_WARN_AT = 70`, `USAGE_DANGER_AT = 90` (inclusivos, `>=`), `TEMP_WARN_C = 75`, `TEMP_DANGER_C = 85`, `LATENCY_WARN_MS = 250`, `STALE_METRICS_MS = 5 min`. Se eligió 70/90 porque ya era el default del `Meter`, el de las ventanas de uso y los tests de primitivas; Machines usaba 75 (disco al 71 % ahora sale en warn). No definir umbrales en las vistas.
- **Tiempo relativo**: `formatRelative` (compacto) para listas/tablas; `formatRelativeSpan`/`formatSpan` (preciso) para cuentas atrás y vencimientos. No escribir formateadores locales.
- **Estructura de una vista**: `<section className="ui-view …">` → `PageHeader` → `StatStrip` (KPI) → `Card`s. Etiquetas con `.ui-label`, números con `.num`, tablas con `Table`, vacíos con `EmptyState`, avisos con `Callout`, pares clave/valor con `KeyValue`. El CSS de cada vista solo contiene layout propio (prefijo `mv-`/`sv-`/`px-`/`se-`).
- **Colores y temas**: solo `var(--token)`; `test/styles.test.ts` falla si un CSS usa un color literal o una variable que no exista en ambos temas.
- **Idioma**: Machines y shell en inglés; Subscriptions/Proxy/Secrets en español (sin unificar; pregunta abierta).

## Propuestas / preguntas abiertas

1. **Tema por defecto**: hoy `system` (un OS claro verá el tema claro). Alternativa: forzar `dark` hasta que el usuario elija. Pendiente de Facundo.
2. **`netRxBps`/`netTxBps`**: el contrato no dice la unidad; asumí **bytes/s** (`formatBps`). Si es bits/s hay que aclararlo en `contracts/machines.ts`.
3. **Badge de Proxy** cuenta errores de la última hora; podría ser rate-limits o failovers. ¿Qué prefiere ver?
4. **Fuentes en el riel de iconos**: solo puntos de estado (con `title`); en <600 px se ven completas dentro del cajón.
5. **Fuentes tipográficas**: se mantiene el stack del sistema/mono (sin CDN). Si se quiere Inter/JetBrains Mono habría que empaquetarlas (dependencia o archivos en `public/`).
6. **`index.html` ahora tiene un `<script>` inline** (tema sin parpadeo). Si el hub sirve la UI con CSP estricta, hay que permitirlo con hash o moverlo a un archivo.
7. **Foco al navegar**: no se mueve el foco a `<main>` al cambiar de ruta (se mantiene en el nav). Solo el skip link enfoca `<main>`.
