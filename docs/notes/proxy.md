# Notas · packages/proxy (bixku-proxy)

Estado: fase 1 implementada y probada **solo con fixtures** (sin puertos ni red). `src/serve.ts` está escrito y nunca se ejecutó.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/app.ts` | Un único handler Fetch-API: `/v1/*`, `/internal/v1/*`, `/healthz` |
| `src/handlers/public.ts` | Endpoints OpenAI/Anthropic, selección de cuenta, failover, medición |
| `src/handlers/internal.ts` | `ProxyInternalRoutes` (bearer admin), `buildStatus`, `buildAccountViews` |
| `src/pool.ts` | Pool por proveedor: prioridad, active/standby, round-robin/fill-first, afinidad, cooldowns |
| `src/metering/{sse,usage}.ts` | Parser SSE incremental, extracción de tokens, `tapStream` (passthrough + medición) |
| `src/pricing.ts` | Tabla de precios versionada y `computeCost` |
| `src/ratelimit.ts` | Headers de rate-limit → `UsageWindow`, pistas de cooldown |
| `src/store/records.ts`, `src/store/sqlite.ts` | `RecordStore` append-only: memoria y SQLite (`node:sqlite`) |
| `src/clients.ts` | Llaves de cliente (HMAC + pepper, comparación en tiempo constante), globs |
| `src/secrets.ts` | `secrets.enc` AES-256-GCM, llave maestra desde archivo |
| `src/redact.ts` | Redactor central y logger JSON |
| `src/config.ts` | Esquema zod de la config JSON |
| `src/translate.ts` | Stub de traducción entre formatos (fase 2, responde 501) |
| `scripts/secrets.ts`, `scripts/hash-client-key.ts` | Utilidades del operador (para el homelab; no se ejecutaron aquí) |

## Decisiones tomadas (revisables)

1. **Config en JSON, no YAML.** Node no trae parser de YAML y así no sumamos dependencias. Es coherente con `config/machines.example.json` y zod da errores precisos. Los comentarios van en claves `"$comment"` (se ignoran al validar).
2. **Dependencia nueva: `zod` en `@bixku/proxy`**, la misma versión que usa core. Valida la config y compone los esquemas de core (`ModelRoute`, `ClientKeyView`). `pnpm-lock.yaml` cambió solo por eso.
3. **Hash de llaves de cliente = HMAC-SHA256(pepper, key)**, que es la forma estándar de hacer "sha256 + pepper". El pepper vive en el secret store (`client-key-pepper`). Se compara contra *todos* los hashes con `timingSafeEqual`, sin salir antes.
4. **Los ids ULID se generan al guardar el record, no al iniciar la request.** Con streams concurrentes, un id tomado al inicio podría quedar detrás de un cursor que el hub ya pasó. `ts` sigue siendo la hora de inicio. `nextCursor` solo viene cuando la página está llena; si no, el hub guarda el último id que vio.
5. **Semántica de tokens en `UsageRecord`**: `inputTokens` = input **sin cache** (en OpenAI se resta `cached_tokens`), `outputTokens` incluye razonamiento, `reasoningTokens` es informativo y `cacheWriteTokens` solo existe en Anthropic. Así el costo se calcula igual para los dos proveedores.
6. **Cache write = 1.25× input** (TTL de 5 min). Las escrituras de 1 h (2×) no se distinguen todavía y el costo sale marcado como `assumed`.
7. **Failover**: solo ante 429, 401/403, 404, 408/5xx, timeout de headers o error de red, y nunca después de un 2xx. Un 400/422 del upstream se devuelve tal cual (es culpa del cliente) y no toca el estado de la cuenta.
8. **401/403 → `error` persistente** hasta `resetError()`. CLIProxyAPI usa 30 min; aquí se prefiere que un token revocado no se reintente cada media hora. En fase 2 habrá un botón con confirmación.
9. **Timeout solo hasta recibir los headers** (`upstreamHeadersTimeoutMs`, 120 s). Un stream largo no se corta. Si el cliente aborta, se cancela el upstream.
10. **`stream_options.include_usage` se inyecta** en streams de OpenAI chat (`injectStreamUsage`) para poder medirlos. Efecto visible: el cliente recibe un chunk final extra con `choices: []`. Los clientes oficiales lo toleran.
11. **Los headers de rate-limit del upstream no se reenvían al cliente** (lista blanca: `content-type`, `request-id`…), así no se filtra el estado de cuentas compartidas. El proxy sí los usa para las ventanas.
12. **`count_tokens` no genera `UsageRecord`**: no consume cuota de generación y ensuciaría las métricas. Sí usa el pool y el failover.
13. **Peticiones rechazadas antes del ruteo** (401 de cliente, 403 por modelo, 400 por body inválido): no generan record porque no hay cuenta. Quedan en el log.
14. **Sin cuenta disponible** (todas en cooldown): 429 con `Retry-After` = el cooldown que termina primero, y un record con `accountId: "none"`.
15. **Los headers del cliente se reenvían con una lista blanca**: `accept`, `anthropic-version`, `anthropic-beta`, `openai-beta`, `user-agent`. El `authorization`/`x-api-key`/`cookie` del cliente **nunca** sube. No se inventa ningún header (ver ToS en `docs/cliproxyapi-parity.md`).
16. **Día "hoy" en UTC** para `AccountView.today`.
17. **SQLite append-only reforzado con triggers** que abortan UPDATE/DELETE.

## Brechas conocidas de fase 1

- **Refresh de tokens OAuth** (Claude Max, ChatGPT/Codex). Los access tokens caducan en horas, así que sin refresh las cuentas de suscripción pasan a `error` al expirar. El punto de extensión ya existe: `CredentialProvider` en `deps.ts`. Es lo primero de la fase 2.
- Traducción entre formatos (501 por ahora). Detalles en `src/translate.ts`.
- Codex por suscripción usa otro endpoint (`chatgpt.com/backend-api/codex/...`) y otros headers. No está soportado; solo OpenAI por API key.
- Precios de OpenAI: placeholders `verified: false` (costo `null`).
- Créditos de pago por uso: `credits: null` por ahora.
- Estado del pool solo en memoria: un reinicio borra cooldowns y errores.

## Cambios de contrato sugeridos (no aplicados: core no es de este paquete)

1. `UsageRecord.costAssumed: boolean`: hoy `computeCost` sabe si el costo usa precios de cache derivados, pero el contrato no tiene dónde guardarlo.
2. `UsageRecord.pricingVersion: string`: para recalcular costos históricos cuando cambie la tabla.
3. `UsageRecord.accountId` podría ser `nullable` en lugar del centinela `"none"` cuando no se eligió cuenta.
4. `UsageRecord.outcome` podría sumar `"stream-error"` para distinguir un error dentro de un stream 200 de un error HTTP del upstream (hoy los dos son `upstream-error`).

## Preguntas abiertas para Facundo

1. **Cloaking/ToS**: ¿confirmas que bixku-proxy no suplanta clientes y que las suscripciones se usan solo desde Claude Code y Codex oficiales? (propuesta en `docs/cliproxyapi-parity.md`)
2. **OAuth**: ¿quieres que la fase 2 implemente login y refresh de Claude/Codex dentro del proxy, o prefieres cargar los tokens con una herramienta aparte y que el proxy solo los refresque?
3. **Headers reales de rate-limit**: ¿puedes capturar headers de respuesta (sin tokens) de una cuenta Max y de una Codex? Los formatos `anthropic-ratelimit-unified-*` y `x-codex-*` son supuestos (por ejemplo, ¿utilization es una fracción 0–1 o un porcentaje? ¿el reset es epoch o ISO?).
4. **Precios de OpenAI/otros**: ¿qué modelos usas? Hay que cargar sus precios verificados con fuente y fecha.
5. **Retención de `usage_records`**: ¿para siempre, o rollups diarios y borrar el detalle después de N días? (hoy los triggers bloquean DELETE).
6. **401/403**: ¿error persistente (propuesta) o un cooldown largo como CLIProxyAPI (30 min)?
7. **Inyectar `include_usage`** en streams de OpenAI: ¿aceptable, o prefieres no tocar el body y estimar el uso?
8. **Afinidad de sesión**: ¿activada por defecto? Mantiene el cache de prompts, pero reparte peor la carga.
9. **¿Persistir el estado del pool** (cooldowns y errores) entre reinicios, en la misma SQLite?
10. **Weighted round-robin y reglas de payload**: ¿los usas hoy en CLIProxyAPI?
