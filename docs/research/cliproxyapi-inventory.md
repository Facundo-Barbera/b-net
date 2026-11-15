# CLIProxyAPI · inventario (investigación de fuente pública)

Fuente: repo público `router-for-me/CLIProxyAPI`, commit `43806c8` (2026-11-15), tag **v8.0.73**. Solo se leyó documentación y código fuente. **No se tocó la instancia real de Facundo.** Rutas relativas al repo.

## Runtime y config
- Go (módulo `/v8`, gin), licencia MIT. Binarios en releases y Docker `eceasy/cli-proxy-api`. Puerto por defecto **8317**, en todas las interfaces si `server.host: ""`.
- Config YAML (`-config`, `config-version: 8`); las claves planas legacy siguen funcionando. Claves principales: `server.port/host/tls`, `management.secret-key/allow-remote` (sin secreto, la API de management queda deshabilitada), `access.api-keys` (llaves de clientes), `routing.strategy` (round-robin | weighted-round-robin | fill-first), afinidad de sesión, `routing.retry.request-retry` (3), `max-retry-credentials`, `max-retry-interval`, `routing.cooldown.*`, `requests.proxy-url`, reglas `requests.payload`, `observability.logs.*`, `observability.usage.*`, `oauth.auth-dir` (`~/.cli-proxy-api`), `models.catalog`, `plugins`.
- Legacy: `quota-exceeded.switch-project/switch-preview-model` (sin equivalente en v8).

## Proveedores
- OAuth (un JSON por credencial en `auth-dir`): Claude Code (`-claude-login`, callback `localhost:54545`), OpenAI Codex (`-codex-login`, `-codex-device-login`, callback `localhost:1455`), Antigravity (`-antigravity-login`, `:51121`), Kimi, xAI, Devin, Meta; Vertex por import de service account; AI Studio por relay WebSocket.
- Por API key: gemini, interactions, vertex, codex, claude, xai, meta y `openai-compatibility` (OpenRouter, etc.), cada uno con base-url, headers, proxy, prefix, priority, weight, aliases y excluded-models.
- Eliminados: Gemini CLI OAuth (2026-06), Qwen Code (2026-04), iFlow (2026-04).
- Claude: hace "cloaking" para hacerse pasar por Claude Code cuando el cliente no lo es (`claude_executor_cloaking.go`).

## Endpoints para clientes
- OpenAI: `/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/responses` (también por WebSocket), `/v1/responses/compact`, imágenes, video, audio/tts, realtime/live.
- Anthropic: `/v1/messages`, `/v1/messages/count_tokens`.
- Gemini: `/v1beta/models/*` (generateContent, streamGenerateContent), `/v1beta/interactions`.
- Codex nativo: `/backend-api/codex/responses`. Otros: `/healthz`, `/management.html`, `/v1/ws`, `/v1/tunnel`.
- SSE con keep-alives opcionales y traducción entre formatos (`internal/translator/*`). El razonamiento se controla con un sufijo en el modelo, p. ej. `modelo(high)` o `modelo(16384)`. Tiene aliases y prefijos de modelo.

## Multi-cuenta
- Prioridad por niveles, peso, afinidad de sesión con failover.
- Reintentos: una primera ronda por todas las credenciales elegibles y luego `request-retry` rondas solo para 403/408/429/5xx. Las reglas `request-scoped-errors` deciden stop o continue, con o sin cooldown.
- Cooldown por credencial **y por modelo**: 429 con backoff de 1 s a 30 min que respeta Retry-After; 401/402/403 → 30 min; 404 → 12 h; 408/5xx → 60 s. Una violación de ToS deshabilita la credencial.
- Flag `disabled` persistido; hot reload de config y auth-dir con fsnotify; 16 workers para refrescar tokens.

## Management API
- `/v0/management/*` (144 rutas) y `/v8/management/*`, con `Authorization: Bearer` o `X-Management-Key`. Solo localhost salvo `allow-remote`. Banea la IP 30 min tras 5 fallos.
- Cubre config, llaves, CRUD de upstreams, auth-files (subir y bajar), URLs de login OAuth, logs, `/usage-queue`, `/api-key-usage`, cuota y plugins.
- **Las estadísticas de uso se quitaron del núcleo en v6.10.0**. Queda una cola en memoria de 60 s y contadores por API key, ninguno persistido.

## Auth de clientes
- `access.api-keys` es una lista plana. Acepta la llave en Bearer, X-Api-Key, X-Goog-Api-Key o `?key=`. **No hay restricciones por llave** (modelos, cuotas).

## Ecosistema
- Management Center (web, `/management.html`), EasyCLI (escritorio), TUI, SDK Go embebible y plugins C-ABI.

## No verificado
- Esquema exacto de los JSON de tokens por proveedor; puertos de callback de Kimi, xAI y Meta; cambio de proyecto de Gemini en v8; para qué son los puertos 8085 y 11451 del docker-compose. Tampoco qué versión y qué proveedores usa **la instancia de Facundo** (ver open-questions).
