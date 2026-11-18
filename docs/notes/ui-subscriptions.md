# UI: Subscriptions, Proxy y Secrets (notas de implementación)

Vistas en `packages/web/src/views/{subscriptions,proxy,secrets}`. Todas reciben solo `{ snapshot }`; el "ahora" sale de `useNow()` (ver abajo). Tests en `packages/web/test/{subscriptions,proxy,secrets}.test.tsx`.

## Decisiones tomadas

- **Reloj.** Las vistas ya no aceptan `now`: usan `useNow()` del shell. En modo fixture es `snapshot.generatedAt` (coherente con los datos y determinista); en modo live es el reloj real con tick de 30 s, así que los conteos regresivos siguen bajando aunque el hub deje de responder. Los tests usan `renderAt()` (`test/helpers.tsx`).
- **Estilos.** Solo variables de `tokens.css`. Los rellenos tintados usan `color-mix(in srgb, var(--tone) N%, transparent)` sobre esas variables. No se tocó `tokens.css`. Superficies, tablas, badges, KPI, callouts y listas clave/valor vienen de `src/components` (clases `ui-*` y utilidades `u-*`); las vistas solo conservan layout con prefijo `sv-`, `px-`, `se-`.
- **Gráficas.** SVG en línea: barras de ventana (`Meter` compartido, vacío con "sin dato" cuando `usedPct` es `null`; el `role` ahora es `meter`), barra costo-vs-plan, barra segmentada de migración, mini-barra de duración.
- **Helpers.** `_shared/` desapareció: el formato vive en `src/lib/format.ts` (`formatSpan`, `formatCountdown`, `formatRelativeSpan` con `lang: "es"`, `formatUsdHeadline`, `formatMoney`, `formatInt`) y los textos en español de tiempo relativo en `lib/spanish.ts` (adaptadores para `RelativeTime format`). Idioma: toda la UI en español.
- **Secrets.** Cada celda sale de un campo con nombre de `SecretMeta`; la fila nunca se esparce ni se serializa. No hay `input`, `button`, enlaces ni `download`. Un test inyecta campos extra (`value`, `token`…) en tiempo de ejecución y comprueba que no llegan al DOM. Otro revisa todos los atributos del DOM contra una lista permitida (`data-testid`, `data-status`).
- **Huella.** Si el payload trae algo que no sean 8 hex, se muestra `—`.
- **Valor de la suscripción.** `costo 30 d a precio de lista ÷ precio del plan`, por cuenta. El resumen global usa solo cuentas con plan > 0.
- **Barra de uso.** Umbrales de `src/lib/thresholds.ts`: < 70 % ok, 70–89 % warn, ≥ 90 % danger. `usedPct = null` muestra "sin dato" y resalta el total medido por nosotros.

## Propuestas (necesitan decisión de Facundo)

1. **Frescura.** Con la regla única del shell, en live los conteos siguen bajando aunque el hub deje de responder. Falta un indicador "datos de hace X" cuando `generatedAt` sea viejo.
2. **Aviso "fuera del hub".** `SecretsView` marca `oauth-token` y `api-key` cuyo `machineId` ≠ `hubMachineId` (arquitectura §6.2). Es una heurística de UI; si hay secretos legítimos fuera del hub, se quita.
3. **Cuentas en `error`.** Hoy solo se muestra el `lastError` como alerta. Cuando haya acciones (fase 2) iría ahí el botón "re-login".
4. **Migración.** El progreso cuenta clientes en `b-net-proxy`; `both` cuenta como "en paralelo", no como migrado. El contrato no tiene "días sin tráfico en CLIProxyAPI" (criterio del paso 4), así que la nota es texto fijo. Propongo agregar `legacyProxy.lastRequestAt` al contrato si se quiere automatizar ese criterio.
5. **Prioridad del pool.** La cuenta se ordena por `priority` dentro de su proveedor. Si el pool pasa a `fill-first`/`round-robin`, conviene mostrar la estrategia en la vista Proxy (hoy no está en `ProxyStatus`).
6. **Zona horaria.** Todo es relativo ("hace 2m", "en 4d 3h"); la fecha exacta ISO está en el `title` de cada `<time>`. Falta decidir si se quiere hora local absoluta en las tablas.

## Pendiente / fuera de alcance

- Sin acciones de escritura (fase 1 es solo lectura).
- Sin paginación ni filtros en "Requests recientes" (el contrato acota a ~50).
- Sin verificación visual en navegador (la regla del proyecto prohíbe `vite dev/preview` en bixku-vps): solo `vite build` y tests de componentes.
