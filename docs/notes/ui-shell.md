# UI shell: notas y propuestas

Área: `packages/web/src/{shell,components,lib,styles}`. Para los hijos que escriben las vistas.

## Qué hay

- **Shell** (`shell/`): `App` (datos + ruta hash + tema) → `Shell` (skip link, `Sidebar`, `Topbar`, `<main id="main-content">`). `App` acepta `mode` para tests (`<App mode="fixture" />`).
- **Responsive**: ≥900 px sidebar completa (232 px) · 600–899 px riel de iconos (56 px, etiquetas solo para lectores de pantalla) · <600 px cajón con botón de menú (Escape, backdrop y navegar lo cierran).
- **Tema**: `system | dark | light` en `localStorage["b-net.theme"]` (todo en try/catch), escribe `data-theme` en `<html>`. `index.html` aplica el tema guardado antes del primer paint.
- **Reloj**: `NowProvider`/`useNow()`. En modo fixture "ahora" = `snapshot.generatedAt` (el fixture se ve vivo y los tiempos relativos son deterministas); en modo live es el reloj real con tick cada 30 s.
- **Badges del nav** (`shell/badges.ts`, `deriveNavBadges`): Machines = offline (si no hay, degraded) · Subscriptions = cuentas en cooldown/error · Proxy = errores de la última hora · Secrets = expiring/expired/invalid.

## Primitivas (`import { … } from "../../components/index.ts"`)

| Nombre | API |
|---|---|
| `Card` / `Panel` | `title?, subtitle?, actions?, flush?, headingLevel?=2` + props de `<section>` |
| `StatusDot` | `tone?, label?, pulse?` (sin `label` es decorativo) |
| `Badge` | `tone?, variant?: "soft"\|"outline"` + props de `<span>` |
| `Meter` | `value (0–100\|null), warnAt?=70, dangerAt?=90, tone?, label?, showValue?, valueText?` (`role="meter"`) |
| `Sparkline` | `values, width?=96, height?=24, min?, max?, tone?=info, label?` |
| `Stat` | `label, value, unit?, hint?, tone?` (`<dl>`; valor en mono) |
| `RelativeTime` | `value, now?, fallback?` → `<time>` con tooltip UTC |
| `EmptyState` | `title, description?, icon?, action?, role?` |
| tonos | `Tone`, `meterTone`, `toneForMachineStatus`, `toneForPoolState`, `toneForSecretStatus` |
| iconos | `MachinesIcon`, `SubscriptionsIcon`, `ProxyIcon`, `SecretsIcon`, `SunIcon`, `MoonIcon`, … (SVG inline, `1em`) |

Formatters en `lib/format.ts`: `formatBytes`, `formatBps` (**bytes**/s), `formatPercent`, `formatTokens`, `formatUsd`, `formatDuration` (segundos), `formatMs`, `formatRelative(t, now?)`, `formatAbsolute`. Todos devuelven `—` para null/NaN.

Utilidades CSS: `.ui-label` (etiqueta pequeña en mayúsculas), `.num` (mono tabular), `.ui-grid` (grid auto-fill de tarjetas), `.sr-only`, clases `tone-*` (fijan `--tone`). Tokens nuevos: `--accent-fg`, `--overlay`, `--sidebar-w`, `--rail-w`, `--topbar-h`, `--focus-ring`, `--ease`. Los nombres existentes no cambiaron.

## Convenciones para las vistas

- El título de página lo muestra la barra superior (`data-testid="page-title"`, **no** es un heading). Cada vista conserva su propio `<h1>`/`data-testid="view-<id>"`; las `Card` usan `<h2>`.
- Los colores solo vía variables; los números en `.num`.
- Sin scroll horizontal a 375 px: tablas anchas dentro de un contenedor con `overflow-x: auto`.
- Tests de vistas: envolver con `NowProvider` o pasar `now` a `RelativeTime` para tiempos deterministas.

## Propuestas / preguntas abiertas

1. **Tema por defecto**: hoy `system` (un OS claro verá el tema claro). Alternativa: forzar `dark` hasta que el usuario elija. Pendiente de Facundo.
2. **`netRxBps`/`netTxBps`**: el contrato no dice la unidad; asumí **bytes/s** (`formatBps`). Si es bits/s hay que aclararlo en `contracts/machines.ts`.
3. **Badge de Proxy** cuenta errores de la última hora; podría ser rate-limits o failovers. ¿Qué prefiere ver?
4. **Fuentes en el riel de iconos**: solo puntos de estado (con `title`); en <600 px se ven completas dentro del cajón.
5. **Fuentes tipográficas**: se mantiene el stack del sistema/mono (sin CDN). Si se quiere Inter/JetBrains Mono habría que empaquetarlas (dependencia o archivos en `public/`).
6. **`index.html` ahora tiene un `<script>` inline** (tema sin parpadeo). Si el hub sirve la UI con CSP estricta, hay que permitirlo con hash o moverlo a un archivo.
7. **Foco al navegar**: no se mueve el foco a `<main>` al cambiar de ruta (se mantiene en el nav). Solo el skip link enfoca `<main>`.
