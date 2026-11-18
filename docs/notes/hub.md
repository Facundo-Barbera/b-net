# Notas · hub (API + agregación) y clientes Beszel / Tailscale

Rama: `t3/hub-api-aggregation-clients`. Todo se validó con fixtures FALSOS (IPs `100.64.x.y`, ids y llaves inventados). No se llamó a Beszel, a tailscaled ni a ninguna otra máquina, y no se levantó ningún servidor.

## Qué hay

| Pieza | Archivo |
|---|---|
| Cliente Beszel (PocketBase) | `packages/core/src/clients/beszel/index.ts` → `@b-net/core/clients/beszel` |
| Cliente Tailscale (CLI / LocalAPI + parser de `tailscale ping`) | `packages/core/src/clients/tailscale/index.ts` → `@b-net/core/clients/tailscale` |
| Fixtures falsos | `packages/core/test/fixtures/{beszel,tailscale}/` |
| Config (env + machines.json) | `packages/hub/src/config.ts`, `config/hub.example.env` |
| SourceTracker (SourceHealth + último valor) | `packages/hub/src/health.ts` |
| Fetchers (agentes, proxy, ingesta, ciclo Tailscale) | `packages/hub/src/sources.ts` |
| Reglas de estado | `packages/hub/src/status.ts` |
| Agregador puro → HubSnapshot | `packages/hub/src/aggregate.ts` |
| Runtime (pollers, staleness, snapshot) | `packages/hub/src/hub.ts` |
| UsageStore (memoria + `node:sqlite`) | `packages/hub/src/store.ts`, `store-sqlite.ts` |
| Handler Fetch-API + estáticos | `packages/hub/src/http.ts` |
| Entrypoint `node:http` (NO se ejecutó aquí); carga su env de `HUB_ENV_FILE` (por defecto `.env` en la raíz del repo), sin pisar variables ya definidas | `packages/hub/src/serve.ts` |

## Decisiones

1. **Reglas de estado** (en orden, `status.ts`):
   - `unknown`: no hay datos frescos de Tailscale ni métricas frescas.
   - `offline`: Tailscale dice offline (o el nodo no está en el tailnet) y no hay métricas frescas. Si hay métricas frescas, ganan sobre un "offline" de Tailscale.
   - `paused`: solo cuando Beszel tiene el sistema en `paused`.
   - `online` sin métricas: alcanzable por Tailscale pero sin fuente de métricas (ni `agentUrl`, ni `beszelName` con Beszel configurado en el hub). Llega con `metricsSource: "none"` y la UI dice qué fuente falta. Así queda MBA en el fixture canónico. Antes salía `paused`, que se leía como "alguien la detuvo".
   - `degraded`: CPU, RAM o disco **> 90 %** (estricto), métricas más viejas que **300 s** teniendo fuente configurada, o Beszel en `down` con Tailscale online. Un `beszelName` sin Beszel configurado no cuenta como fuente (no marca `degraded` por una fuente nunca conectada).
   - `online`: el resto.
   Los umbrales están en `DEFAULT_THRESHOLDS` y se pueden inyectar.
2. **Prioridad de métricas**: agente fresco > Beszel (con datos) > agente viejo > nada. "Fresco" significa ≤ `staleMetricsSec`.
3. **Staleness de fuentes**: el último valor bueno se conserva. El agregador lo ignora cuando pasan más de 3 ciclos (fast 15 s → 45 s; agentes 30 s → 90 s). En ese caso `SourceHealth.ok=false` y lleva el error saneado (sin bearer, tokens ni `sk-…`; máximo 200 caracteres).
4. **Latencia**: se mide solo desde el hub, con un ping `disco` por peer configurado, online y distinto de self en cada ciclo (concurrencia 4, timeout 3 s). Si el ping responde, su ruta (direct/derp/peer-relay) tiene prioridad sobre la que se infiere de `status` (`CurAddr` → direct, `PeerRelay` → peer-relay, `Active` + `Relay` → derp).
5. **CLI `tailscale ping`**: se ejecuta con `-c 1 --until-direct=false --timeout=Ns`. El `ExecFn` inyectado **no debe lanzar** con exit≠0, porque tailscale sale con 1 cuando no logra conexión directa. Se toma la última línea `pong from …`. TSMP no informa la ruta, así que queda como `unknown`.
6. **Hilos T3**: el hub los consume solo por HTTP (`AgentRoutes.t3Threads`). En los agentes declarados en `machines[].agentUrl`, el `machineId` sale de la **config del hub**, no de lo que diga el agente. Las URLs de `T3_EXPORTERS` que no están en machines.json se consultan aparte y conservan el `machineId` que reportan. Los hilos de máquinas que no están en config se descartan. `threadCounts` no cuenta los `archived`.
7. **Secrets**: `/internal/v1/secrets` se proyecta a las claves de `SecretMeta` **antes** de validar (`projectSecrets`) y las entradas inválidas se descartan. `/api/v1/secrets` vuelve a validar con el esquema `.strict()`. Hay tests que comprueban que un campo `value` inyectado nunca llega a la respuesta.
8. **Usage records**: la ingesta va dentro del ciclo del proxy (`?since=<cursor>&limit=500`, hasta 20 páginas por ciclo) y es idempotente por id. El cursor solo avanza después de guardar la página. Con `HUB_DATA_DIR` se usa `node:sqlite` (`<dataDir>/hub.sqlite`, WAL); sin él, memoria.
9. **HTTP**: solo GET/HEAD (405 en el resto). Bearer opcional en `/api/*`, comparado en tiempo constante sobre sha256. Las respuestas `/api` llevan `no-store`, `nosniff` y `X-Frame-Options: DENY`. La UI se sirve desde `packages/web/dist/app` cuando existe `index.html`, con fallback SPA para rutas sin extensión, sin dotfiles ni `..`. `/api/v1/health` devuelve `ok: true` si el proceso vive; el detalle está en `sources`.
10. **Config**: `HUB_LISTEN_HOST` es obligatorio y se rechazan `0.0.0.0`, `::` y vacío. Los secretos se leen de `*_FILE` (con fallback a env), y Beszel se desactiva si la contraseña es el placeholder `__CHANGE_ME__`. Las variables extra están en `config/hub.example.env`.
11. **Beszel**: autentica con `users/auth-with-password` y manda el token tal cual en `Authorization` (estilo PocketBase). Ante un 401 re-autentica una vez. Para la historia lee 30 registros `system_stats` de `type='1m'`, ordenados por `-created`. Los errores nunca incluyen el token ni la contraseña.
12. `services` (ServiceProbe) queda vacío: ninguna fuente lo provee todavía.

## Campos de Beszel sin verificar (inferidos del código público)

- `systems.info`: `h, k, c, t, m, u, cpu, mp, dp, b, v`, `la` (load avg en agentes nuevos), `l1` (agentes viejos), `dt` (temperatura de dashboard).
- `system_stats.stats`: `cpu, m, mu, mp, d, du, dp, ns, nr, t, la`.
- Unidades supuestas: memoria y disco en **GB**; red `ns`/`nr` en **MB/s**, convertidos con 1024² (¿MiB o MB?). `t` es un mapa sensor → °C y se usa el máximo.
- Valores de `systems.status`: `up | down | paused | pending`.
- `system_stats.type = '1m'`: ¿existe en tu versión o el mínimo es `10m`?

## Cambios de contrato propuestos (no aplicados)

- `SourceHealth.source` no tiene un valor para los exportadores T3 sin máquina. Hoy van como `t3` con `machineId: null`. Propuesta: no hace falta cambiarlo.
- `MachineView` podría llevar `statusReasons: string[]` (ya se calculan en `deriveStatus`) para que la UI muestre por qué una máquina está `degraded`.
- `AgentRoutes` podría aceptar un `?since=` en los hilos para no transferir todo cada 30 s (menor prioridad).

## Preguntas abiertas para Facundo

1. ¿Te sirven los umbrales de 90 % para CPU/RAM/disco? ¿Quieres umbrales por máquina (p. ej. disco del PC)?
2. ~~¿Una máquina sin fuente de métricas debería verse `paused` u `online`?~~ Decidido: `online` con `metricsSource: "none"`; `paused` queda solo para Beszel.
3. ¿Un token por agente o uno común (`HUB_AGENT_TOKEN_FILE`)? Hoy es uno común.
4. ¿Qué versión de Beszel tienes? ¿Existe el tipo `1m` en `system_stats`? ¿Las unidades de red son MB/s?
5. ¿LocalAPI (necesita que el usuario del servicio pueda leer el socket de tailscaled) o CLI? Por defecto se usa `localapi`.
6. ¿Ping `disco` (ruta real por magicsock) o `TSMP` (pasa por la pila de WireGuard)? Hoy es `disco`.
7. ¿Activamos `HUB_API_TOKEN` desde el día 1 o basta con el bind en Tailscale + ACLs?
