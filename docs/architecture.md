# b-net · Arquitectura (fase 1)

> Estado: propuesta para revisión de Facundo. Las decisiones marcadas **[propuesta]** tienen su pregunta en `docs/open-questions.md`.

## 1. Objetivo

Un hub propio del homelab que reemplaza tres cosas:

| Hoy | Reemplazo |
|---|---|
| UI de Beszel | Vista **Machines** del hub (fase 1 lee Beszel; fase 2 usa el agente propio) |
| `fleet status` | Mapa de máquinas + hilos de T3 por máquina |
| CLIProxyAPI | **b-net-proxy** (OpenAI + Anthropic compatible, pool de cuentas, medición) |

Inspiración visual: dashboard strawhat (oscuro, mapa de máquinas con latencia, CPU/RAM, sandboxes despiertas/dormidas, suscripciones con ventanas 5 h/semanales, costo a precio de lista, créditos).

## 2. Componentes y monorepo

```
b-net/
├─ packages/
│  ├─ core/    @b-net/core   contratos compartidos (zod + tipos), fixtures canónicos, clientes tipados
│  ├─ hub/     @b-net/hub    API /api/v1 + agregación de fuentes + sirve la UI compilada
│  ├─ proxy/   @b-net/proxy  proxy de modelos (OpenAI/Anthropic), pool de cuentas, medición
│  ├─ agent/   @b-net/agent  agente ligero opcional por máquina (métricas + exportador T3)
│  └─ web/     @b-net/web    UI React (Vite), vistas Machines / Subscriptions / Proxy / Secrets
├─ docs/
└─ config/     ejemplos de configuración (sin secretos)
```

- Runtime: **Node ≥ 22.18** con type stripping nativo (`node archivo.ts`, sin paso de build para backend). Gestor: **pnpm** workspaces. Tests: **vitest** (proyecto `node` y proyecto `web` con jsdom).
- Contratos: `packages/core/src/contracts/*.ts`. Son la única fuente de verdad de las formas de datos entre hub, proxy, agente y UI. Cambiarlos requiere actualizar el fixture canónico (`core/src/fixtures/snapshot.ts`) y su test.

### Despliegue objetivo (lo hace Facundo, no este repo)

| Máquina | Corre | Escucha |
|---|---|---|
| bixku-homelab | hub, proxy, (agente) | solo IP de Tailscale: hub `:8780`, proxy `:8318` (CLIProxyAPI sigue en `:8317`) |
| bixku-vps, Focaltec, PC (WSL), MBP, MBA | agente opcional | IP de Tailscale `:8781` |

bixku-vps es **solo para escribir código**: nada de servicios ahí durante el desarrollo.

## 3. Flujos de datos

```
                ┌──────────── bixku-homelab ─────────────┐
 navegador ───► │ hub :8780  ──► /api/v1/snapshot (UI)    │
 (Tailscale)    │   │  ├─ pull 15s ─► Beszel PocketBase :8090 (127.0.0.1)
                │   │  ├─ pull 15s ─► tailscaled LocalAPI (status + ping)
                │   │  ├─ pull 15s ─► proxy /internal/v1/{status,accounts,records,secrets}
                │   │  └─ pull 30s ─► agentes /agent/v1/{metrics,t3/threads} (cada máquina)
                │   └─ SQLite local: histórico de usage records + series cortas
                │ proxy :8318 ◄── clientes (T3, opencode, bot) ──► upstreams (Anthropic, OpenAI…)
                └─────────────────────────────────────────┘
```

1. **Máquinas.** El hub une tres fuentes por `MachineConfig` (`config/machines.json`): Tailscale (online, IP, lastSeen, ruta direct/DERP), latencia medida desde el hub (`tailscale ping` vía LocalAPI, un ping por peer cada ciclo, timeout corto) y métricas. Fase 1: métricas de Beszel (`systems` + `system_stats`). Fase 2: el agente; la prioridad por máquina es agente > Beszel > nada (`metricsSource`).
2. **Hilos T3.** T3 guarda su estado en `~/.t3/userdata/statev2.sqlite` en cada máquina. El agente de cada máquina lo abre **en solo lectura** (`node:sqlite`, `readOnly: true`, `PRAGMA query_only`) y expone `T3ThreadView[]`. El hub nunca abre bases remotas. Estado derivado: `active` (run `running` o provider thread `active`), `waiting` (runtime request pendiente), `idle` (sesión `ready`), `dormant` (sesión `stopped`/`not_loaded`), `archived`.
3. **Uso de IA.** El proxy escribe un `UsageRecord` por request (append-only, sin prompts ni headers). Las ventanas 5 h/semanales salen de dos fuentes: headers de rate-limit del upstream (autoritativo, `source: provider-headers`) y agregación propia de records (`estimated`). El costo siempre es a **precio de lista** con la tabla de precios versionada del proxy. Los créditos de pago por uso vienen de la API del proveedor cuando existe o de un valor manual.
4. **UI.** Una sola llamada `GET /api/v1/snapshot` cada 15 s (`HubSnapshot`). En fase 1 la UI usa el fixture canónico (`?data=live` para la API real).

## 4. API entre componentes

Definida en `packages/core/src/contracts/api.ts`:

- Hub → UI: `HubRoutes` (`/api/v1/snapshot`, `/machines`, `/threads`, `/usage/accounts`, `/usage/records`, `/proxy/status`, `/secrets`, `/health`). Solo lectura en fase 1.
- Bots → Hub (fase 2): `/api/v1/projects` y `/api/v1/projects/:id/deliverables` (contratos en `contracts/projects.ts`). Es la única escritura del hub: `POST` siempre con un token bearer **por bot** (en `HUB_BOT_TOKENS_FILE`, guardado como sha256), y el autor del entregable sale del token. Los archivos van en streaming a `<HUB_DATA_DIR>/deliverables` (1 GiB por archivo, cuota total `HUB_DELIVERABLES_QUOTA_GB`) con el tipo verificado por contenido, y los metadatos van a `hub.sqlite`. El contenido se sirve con `Content-Security-Policy: sandbox` (salvo PDF), `nosniff` y `Content-Disposition`.
- Proxy → Hub: `ProxyInternalRoutes` (`/internal/v1/...`), con bearer token de admin. Paginación de records por cursor ULID.
- Proxy → clientes: `ProxyPublicRoutes` (`/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/messages`, `/v1/messages/count_tokens`).
- Agente → Hub: `AgentRoutes` (`/agent/v1/health`, `/metrics`, `/t3/threads`), con bearer token por agente.

Todos los handlers se escriben como `(req: Request) => Promise<Response>` (Fetch API estándar) con dependencias inyectadas (fetch upstream, reloj, stores). Así se prueban sin abrir puertos; el `serve.ts` de cada paquete solo los monta en `node:http`.

## 5. Proxy: diseño

- **Pool por proveedor**: cuentas con `priority`, estado `active | standby | cooldown | disabled | error`. Estrategias: `round-robin` (por defecto) y `fill-first`. Afinidad de sesión opcional, para no romper el cache de prompts al rotar.
- **Cooldown**: 429 → respeta `retry-after` o el reset de la ventana de los headers; si no hay, backoff exponencial de 1 s a 30 min. 401/403 → `error` y se pide re-login. 5xx/timeout → cooldown corto de 60 s. 404 de modelo → cooldown solo de ese modelo.
- **Failover**: reintento con la siguiente cuenta elegible si **todavía no se envió ningún byte al cliente**. Una vez iniciado el stream no hay failover; se registra el error. Las cuentas `standby` entran solo cuando no quedan `active`.
- **Medición**: tokens desde `usage` (no-stream) o desde los eventos SSE (`message_start`/`message_delta` en Anthropic, chunk final con `usage` en OpenAI). Costo con `pricing` (input, output, cache write, cache read y tramos por contexto).
- **Clientes**: llaves por cliente (guardadas como hash), `allowedModels` por glob y estado de migración.
- **Traducción entre formatos** (cliente OpenAI → upstream Anthropic y viceversa): fase 2. En fase 1 cada endpoint va a proveedores de su mismo formato. La matriz completa está en `docs/cliproxyapi-parity.md`.

### ¿TypeScript o Go para el proxy? [propuesta: TypeScript]

CLIProxyAPI está en Go. Recomendamos TypeScript por estas razones:
1. **Un solo toolchain y contratos compartidos.** `UsageRecord`, `AccountView` y `SecretMeta` se validan con los mismos esquemas zod en proxy, hub y UI. En Go habría que duplicarlos y mantenerlos sincronizados.
2. **Carga baja.** Es un homelab con pocos clientes y decenas de requests por minuto. El proxy es I/O-bound: `fetch` + streams de Node sobran, y el overhead frente a Go es despreciable al lado de la latencia del modelo.
3. **Tests sin puertos.** Los handlers Fetch-API se prueban con fixtures de SSE en memoria.
4. **RAM**: bixku-homelab tiene 7.5 GB; un proceso Node ocioso usa ~60–90 MB, frente a ~20–30 MB de Go. Es aceptable, pero es el principal argumento a favor de Go, junto con distribuir un único binario.

Si la RAM o la distribución pesan más, el proxy se puede reescribir en Go conservando el contrato HTTP interno (`/internal/v1/*`). El hub no se entera.

## 6. Modelo de seguridad

1. **Red**: todo escucha solo en la IP de Tailscale de su máquina (nunca `0.0.0.0`). Recomendado: ACLs de Tailscale para que solo los dispositivos de Facundo lleguen al hub y al proxy, y solo el hub llegue a los agentes.
2. **Credenciales upstream** (tokens OAuth y API keys): solo en bixku-homelab, en un **secret store cifrado** (`secrets.enc`, AES-256-GCM, una entrada por secreto). La llave maestra entra por `systemd-creds`/`LoadCredential`, nunca por env ni por el repo. Hay alternativas en open-questions.
3. **El proxy nunca expone valores**: `/internal/v1/secrets` devuelve `SecretMeta` (esquema `.strict()`, sin campo para el valor; solo una huella de 8 hex de sha256). La UI no tiene ninguna forma de pedir un valor.
4. **Logs**: un redactor central enmascara `authorization`, `x-api-key`, `cookie`, `*token*`, `*secret*` y patrones `sk-…`. Los `UsageRecord` no guardan prompts, respuestas ni headers.
5. **Llaves de cliente**: se guardan solo como hash (sha256 + pepper del secret store) y se comparan en tiempo constante.
6. **Tokens entre servicios** (hub→proxy, hub→agente): bearer aleatorio por servicio, en el secret store o en `systemd-creds`.
7. **Solo lectura**: en fase 1 el hub no tiene endpoints de escritura. Las acciones (deshabilitar cuenta, rotar, re-login) se harán en fase 2 con confirmación explícita.
8. **T3**: el agente abre la base de T3 en solo lectura y solo extrae metadatos de hilos (título, estado, modelo, rama), nunca mensajes.
9. **Repo**: `.env.example` con placeholders; `.gitignore` excluye `.env*`, `secrets/`, `*.enc` y bases SQLite.

## 7. Plan de migración desde CLIProxyAPI

CLIProxyAPI **no se apaga sin aprobación explícita de Facundo**.

| Paso | Qué | Criterio para avanzar |
|---|---|---|
| 0 | Inventario: clientes que usan CLIProxyAPI, modelos que piden y cuentas que usa (lo llena Facundo; ver open-questions) | Lista completa |
| 1 | Desplegar b-net-proxy en `:8318` junto a CLIProxyAPI `:8317`, con las cuentas re-logueadas en el proxy nuevo (sin copiar tokens a mano) | `/internal/v1/status` sano |
| 2 | Mover **un** cliente de bajo riesgo (p. ej. el bot) cambiando su base URL | 48 h sin errores atribuibles; los costos medidos cuadran con los headers |
| 3 | Mover un cliente a la vez (opencode, T3 en cada máquina, …). El campo `migration` del cliente se ve en la vista Proxy | Igual que el paso 2 |
| 4 | Con 0 tráfico en CLIProxyAPI por 7 días: **pedir aprobación a Facundo** para apagarlo | Aprobación explícita |
| 5 | Retirar CLIProxyAPI (`legacyProxy.retired = true`) y conservar su config como respaldo | — |

Rollback en cualquier paso: devolver la base URL del cliente a `:8317`.

## 8. Fases

- **Fase 1 (este repo)**: contratos, clientes tipados (Beszel, Tailscale, T3), proxy con pool, failover y medición en tests, hub API + agregación, agente ligero, UI completa con fixtures.
- **Fase 2**: despliegue en homelab, agente en todas las máquinas en lugar de Beszel, traducción entre formatos, acciones de escritura con confirmación y alertas.
