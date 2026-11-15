# Paridad CLIProxyAPI ↔ b-net-proxy

> Fuente de CLIProxyAPI: `docs/research/cliproxyapi-inventory.md` (repo público `router-for-me/CLIProxyAPI`, v8.0.73, commit `43806c8`). No se tocó la instancia real. Estado de b-net-proxy: rama del paquete `packages/proxy`, solo probado con fixtures.
>
> Leyenda: ✅ hecho y con tests · 🟡 parcial · ⏳ fase 2 · ❌ no se hará · — no aplica.

## Qué hace CLIProxyAPI (resumen)

Proxy en Go (gin), puerto 8317. Expone APIs compatibles con OpenAI, Anthropic, Gemini y Codex nativo. Detrás tiene muchos proveedores: Claude Code, Codex, Antigravity, Kimi, xAI y otros por OAuth (logins interactivos con callbacks locales), además de API keys (gemini, vertex, claude, codex, openai-compatibility…). Traduce entre formatos en las dos direcciones. Rota varias credenciales con prioridad, peso, afinidad y cooldown por credencial y por modelo. Tiene una Management API de unas 144 rutas con una UI web, hot reload de la config y de los auth-files, y plugins. Desde v6.10 casi no registra uso persistido. Hace "cloaking" para hacerse pasar por Claude Code.

## Matriz

| Funcionalidad | CLIProxyAPI | b-net-proxy fase 1 | Fase 2 | No se hará (por qué) |
|---|---|---|---|---|
| **Endpoints OpenAI** `/v1/chat/completions`, `/v1/responses`, `/v1/models` | Sí | ✅ passthrough al mismo formato, SSE incluido | | |
| `/v1/completions` (legacy) | Sí | — | ⏳ si algún cliente lo usa | |
| `/v1/responses` por WebSocket, `/v1/responses/compact` | Sí | — | ⏳ según inventario de clientes | |
| Imágenes, video, audio/TTS, realtime | Sí | — | | ❌ fuera de alcance (homelab de código/chat) salvo pedido explícito |
| **Endpoints Anthropic** `/v1/messages`, `/count_tokens` | Sí | ✅ passthrough, SSE; `count_tokens` sin medición | | |
| `/v1/models` con forma Anthropic | Sí | ✅ si llega `anthropic-version` | | |
| Endpoints Gemini `/v1beta/models/*`, interactions | Sí | — | ⏳ solo si hay un cliente Gemini | |
| Codex nativo `/backend-api/codex/responses` | Sí | — | ⏳ ver pregunta Codex OAuth | |
| **Traducción entre formatos** (OpenAI ↔ Anthropic, Gemini) | Sí (`internal/translator`) | stub: responde 501 explícito | ⏳ OpenAI chat/Responses ↔ Anthropic | |
| SSE keep-alives propios | Opcional | pasa los del upstream tal cual | ⏳ si un cliente corta por inactividad | |
| Sufijo de razonamiento `modelo(high)` | Sí | 🟡 se normaliza solo para precios; se reenvía tal cual | ⏳ mapear a `thinking`/`reasoning.effort` | |
| Aliases y prefijos de modelo | Sí | ✅ `routes[].match` (glob) + `upstreamModel` | | |
| `excluded-models` por credencial | Sí | ✅ inverso: `accounts[].models` (globs permitidos) | | |
| Reglas de payload (`requests.payload`) | Sí | — | ⏳ si Facundo las usa | |
| **Pool multi-cuenta**: prioridad por niveles | Sí | ✅ | | |
| Estrategias round-robin / fill-first | Sí | ✅ | | |
| weighted-round-robin | Sí | — | ⏳ fácil de añadir | |
| Cuentas standby (solo si no quedan activas) | Implícito por prioridad | ✅ `role: standby` | | |
| Afinidad de sesión | Sí | ✅ header configurable, `metadata.user_id` o `prompt_cache_key` (hash) | | |
| Cooldown 429 con Retry-After, backoff 1 s–30 min | Sí | ✅ también con headers de reset (formato asumido) | | |
| 401/402/403 | Cooldown de 30 min | ✅ estado `error` persistente hasta re-login (más estricto, a propósito) | ⏳ acción "reset" en la UI | |
| 404 → cooldown por modelo | 12 h | ✅ 12 h configurable | | |
| 408/5xx → 60 s | Sí | ✅ más timeout de headers y errores de red | | |
| Failover solo antes del primer byte | Rondas `request-retry` | ✅ máx. `maxAttempts`; nunca después de enviar el 2xx | | |
| `request-scoped-errors` (stop/continue) | Sí | — | ⏳ si hace falta | |
| Deshabilitar credencial por violación de ToS | Sí | — | ⏳ detectar el error y pasarla a `error` | |
| Flag `disabled` persistido | Sí | ✅ en la config (estático) | ⏳ editable desde el hub con confirmación | |
| Hot reload de config y auth-dir | fsnotify | — (se reinicia el servicio) | ⏳ SIGHUP | |
| **Logins OAuth** (Claude, Codex, Antigravity, Kimi, xAI…) | Sí, con callbacks locales | — tokens cargados a mano en el secret store | ⏳ login + **refresh** de tokens (Claude/Codex) | ❌ proveedores sin uso confirmado |
| Refresh de tokens (16 workers) | Sí | — **brecha principal** | ⏳ `CredentialProvider` ya es inyectable | |
| API keys por proveedor + `openai-compatibility` | Sí | ✅ anthropic, openai, openrouter y `other` con `baseUrl` | | |
| Proxy de salida (`requests.proxy-url`) | Sí | — | ⏳ si hace falta | |
| **Cloaking / suplantar Claude Code** | Sí (`claude_executor_cloaking.go`) | — | — | ❌ **Propuesta: no se implementa** (ver abajo) |
| **Auth de clientes**: lista de llaves | Llaves planas en la config | ✅ solo hash HMAC-SHA256 + pepper, comparación en tiempo constante | | |
| Llave en `?key=` / X-Goog-Api-Key | Sí | — solo Bearer y `x-api-key` | | ❌ las llaves en la URL se filtran en los logs |
| Restricción de modelos por llave | **No** | ✅ `allowedModels` (globs) | ⏳ cuotas por cliente | |
| Estado de migración por cliente | — | ✅ `migration` en `ClientKeyView` | | |
| **Medición de uso** persistida | Quitada en v6.10 (cola de 60 s) | ✅ `UsageRecord` append-only en SQLite (triggers bloquean UPDATE/DELETE) | ⏳ retención/rollups | |
| Tokens desde SSE (Anthropic y OpenAI chat/Responses) | Parcial | ✅ | | |
| Costo a precio de lista | No | ✅ tabla versionada con fuente y fecha | ⏳ precios OpenAI verificados | |
| Ventanas 5 h/semanales desde headers | No | 🟡 parser tolerante; formato **no verificado** | ⏳ validar con headers reales | |
| **Management API** (144 rutas, escritura) | Sí | ✅ `/internal/v1/*` solo lectura (status, accounts, records, secrets-meta, clients) | ⏳ acciones con confirmación desde el hub | ❌ subir y bajar auth-files por HTTP |
| Banear la IP tras 5 fallos | Sí | — (solo Tailscale + ACLs) | ⏳ rate-limit de 401 | |
| Management Center UI, EasyCLI, TUI | Sí | — la UI es el hub (`packages/web`) | | ❌ duplicaría el hub |
| SDK Go embebible, plugins C-ABI | Sí | — | | ❌ no hace falta en un homelab |
| **Secretos** | JSON en claro en `auth-dir` | ✅ `secrets.enc` AES-256-GCM por entrada, llave maestra desde archivo (systemd-creds), la API solo da `SecretMeta` | | |
| Redacción de logs | Parcial | ✅ redactor central (headers, `*token*`, `*secret*`, `sk-…`, JWT, `?key=`) | | |
| Bind | Todas las interfaces por defecto | ✅ `serve.ts` se niega a usar `0.0.0.0`/`::` | | |

## Términos de servicio y "cloaking" (propuesta, decide Facundo)

CLIProxyAPI reescribe las peticiones para que el proveedor crea que vienen de Claude Code aunque el cliente sea otro. Eso es suplantar a un cliente y probablemente va contra los términos de Anthropic (y, de forma análoga, contra los de OpenAI para las suscripciones ChatGPT/Codex).

**Propuesta para b-net-proxy:**
- **No** implementar cloaking, ni reescribir `user-agent`/`system`/headers para hacerse pasar por otro cliente, ni falsificar huellas.
- Reenviar con honestidad: se pasan los headers que manda el propio cliente (`anthropic-beta`, `user-agent`, `anthropic-version`) y nada inventado.
- Suscripciones (OAuth) solo detrás de sus clientes oficiales (Claude Code, Codex CLI). El resto de clientes (bot, opencode, scripts) usa **API keys** de pago por uso.
- Si Facundo decide otra cosa, debe quedar escrito como decisión explícita en `docs/notes/proxy.md`, no como código escondido.
