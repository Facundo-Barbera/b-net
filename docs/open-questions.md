# Preguntas abiertas para Facundo

Las decisiones de producto quedan como **propuesta**; nada de esto está fijado. Cada área tiene más contexto en `docs/notes/<área>.md`. Las preguntas con ⭐ bloquean el despliegue o la migración.

## 1. Producto y stack

1. ~~**Nombre final.**~~ Decidido: **b-net** (repo público `Facundo-Barbera/b-net`). Paquetes `@b-net/*`, servicios `b-net` (hub), `b-net-proxy` y `b-net-agent`. Los hostnames reales (`bixku-*`) no cambian.
1b. ⭐ **Licencia.** El repo es público y no tiene licencia, así que por defecto nadie puede reutilizar el código. ¿MIT, Apache-2.0, AGPL-3.0, o sin licencia por ahora? No se agregará ninguna hasta que la decidas.
2. ⭐ **Stack del proxy.** Propuesta: TypeScript, ya implementado (ver `architecture.md §5`). ¿Prefieres Go para tener un único binario y menos RAM en el homelab (7.5 GB)? El contrato `/internal/v1/*` permite reescribirlo sin tocar el hub.
3. **Puertos.** Propuesta: hub `:8780`, proxy `:8318` (junto a CLIProxyAPI `:8317`) y agentes `:8781`. ¿Chocan con algo en el homelab?

## 2. CLIProxyAPI y migración (no se tocó la instancia real)

4. ⭐ ¿Qué versión corre en el homelab? La investigada es v8.0.73. ¿La config es v8 o legacy?
5. ⭐ ¿Qué proveedores y cuentas tiene cargados (Claude Code OAuth, Codex, Antigravity/Gemini, API keys, OpenRouter) y cuántas cuentas hay por proveedor?
6. ⭐ ¿Qué clientes apuntan hoy a CLIProxyAPI (T3 en qué máquinas, opencode, el bot, otros) y qué formato usa cada uno (chat, Responses, Messages)? Hay que saberlo porque la traducción entre formatos queda para la fase 2: el proxy responde 501 si el formato no coincide.
7. ¿Usas aliases, prefijos, sufijos de razonamiento `modelo(high)`, weighted round-robin, reglas de payload o `request-scoped-errors`?
8. ¿Usas la Management Center UI o `/usage-queue` para algo?
9. ⭐ **Términos de servicio.** CLIProxyAPI hace "cloaking" para hacerse pasar por Claude Code. Propuesta: **b-net-proxy no suplanta clientes.** Las suscripciones se usan solo desde los clientes oficiales (Claude Code, Codex) y el resto va con API keys. ¿Confirmas?
10. ⭐ **OAuth.** El refresh de tokens no está implementado (hay un hook para la fase 2). Sin él, las cuentas de suscripción pasan a `error` al expirar el token, en pocas horas. ¿El login y el refresh van dentro del proxy o en una herramienta aparte?
11. **Criterio para apagar CLIProxyAPI**: 7 días sin tráfico. Propuesta: agregar `legacyProxy.lastRequestAt` al contrato para calcularlo en la UI.

## 3. Proxy

12. ⭐ **Headers reales de rate-limit.** ¿Puedes capturar, sin tokens, los headers de respuesta de una cuenta Max y de una Codex? Los formatos `anthropic-ratelimit-unified-*` y `x-codex-*` son supuestos: no sabemos si la utilización es fracción o porcentaje, ni si el reset es epoch o ISO.
13. **Precios de OpenAI y otros.** ¿Qué modelos usas? Sus precios están como `verified: false` y sin costo. Los de Anthropic están cargados con fecha 2026-11-03. Los cache-write sin precio publicado se supusieron en 1.25× el input.
14. **Retención de `usage_records`**: ¿se guardan para siempre, o rollups diarios y borrar el detalle a los N días? Hoy los triggers bloquean el DELETE.
15. **Ante 401/403**: ¿error persistente hasta re-login (propuesta) o cooldown de 30 min, como CLIProxyAPI?
16. ¿Se puede inyectar `stream_options.include_usage` en los streams de OpenAI chat para medir el uso? El cliente recibiría un chunk final extra.
17. ¿Afinidad de sesión activada por defecto? Conserva el cache de prompts, pero reparte peor la carga.
18. ¿Persistir el estado del pool (cooldowns y errores) entre reinicios?
19. **Créditos de pago por uso**: ¿qué cuentas tienen saldo y cuáles exponen API para consultarlo? Las que no tengan API se capturan a mano.

## 4. Fuentes de datos (hub y agente)

20. ⭐ **Beszel**: ¿qué versión es? ¿Puedes crear un usuario de solo lectura? ¿Existe el tipo `1m` en `system_stats`? ¿La red está en MB/s? Los campos abreviados se infirieron del código público.
21. ⭐ **T3**: ¿en qué máquinas corre (vps, homelab, MBP, MBA, PC)? Propuesta: el agente lee la base de T3 en solo lectura en cada máquina. La alternativa son los "linked environments" de T3.
22. **PC-BiXKu**: ¿el agente corre en WSL (métricas de la VM) o hace falta un colector nativo de Windows? Si T3 corre en Windows, leer su SQLite desde `/mnt/c` puede dar problemas de locking.
23. **Runs huérfanos**: si T3 se cierra a mitad de un run, el hilo aparece `active` para siempre. Propuesta: marcarlo `dormant` si no se actualiza en N horas y la sesión está detenida. Esto cambia la regla de `architecture.md`.
24. **Umbrales**: el estado `degraded` se activa con CPU, RAM o disco por encima del 90 % o con métricas de más de 5 min. ¿Te sirven? ¿Los quieres por máquina (p. ej. el disco del PC)?
25. ¿Una máquina sin fuente de métricas se ve como `paused` (como hoy) o como `online`?
26. **Tailscale**: ¿LocalAPI (el usuario del servicio necesita leer el socket de tailscaled) o CLI? Para la latencia, ¿ping `disco` (actual) o `TSMP`? ¿Se mide solo del hub hacia cada nodo (topología en estrella) o entre todos los pares?
27. **Historial del agente**: 60 s × 30 puntos son 30 min. ¿Basta? ¿Hay discos de datos además de `/` que deban sumarse?

## 5. Seguridad

28. ⭐ **Llave maestra del secret store**: propuesta `systemd-creds`. ¿El homelab tiene TPM? Alternativas: `age` con la llave en un USB, o el keyring del sistema.
29. **Tokens entre servicios**: ¿uno por agente, generados por un script del hub, o uno común? Hoy es uno común. ¿Activamos `HUB_API_TOKEN` desde el día 1 o basta con el bind en Tailscale y las ACLs?
30. ¿Activamos ACLs de Tailscale para que solo tus dispositivos lleguen al hub y al proxy, y solo el hub llegue a los agentes?
31. **CSP**: `index.html` tiene un script inline (para evitar el parpadeo del tema). Si el hub sirve la UI con CSP estricta, hay que permitirlo con un hash.

## 6. UI

32. **Tema por defecto**: hoy sigue al sistema. ¿Forzamos oscuro?
33. **Panel de máquina**: ¿preseleccionamos una máquina, por ejemplo la de más hilos activos? ¿Guardamos la selección en la URL (`#/machines/bixku-vps`)?
34. **Badge de Proxy en la barra lateral**: hoy cuenta errores de la última hora. ¿Prefieres rate-limits o failovers?
35. **Fechas**: todas son relativas y la hora exacta aparece en el tooltip. ¿Quieres hora local absoluta en las tablas?
36. **Tipografía**: se usa la del sistema y una monoespaciada, sin CDN. ¿Empaquetamos Inter y JetBrains Mono?

## 7. Cambios de contrato propuestos (no aplicados)

- `MachineView.statusReasons`: por qué una máquina está `degraded`.
- `MachineMetrics` con forma de decir "sin dato" en lugar de 0. `AgentHealth.t3Reason` opcional.
- `?since=` en `/agent/v1/t3/threads`.
- `UsageRecord.costAssumed`, `pricingVersion`, `accountId` nullable y outcome `stream-error`.
- `ProxyStatus.strategy` (round-robin o fill-first) y `legacyProxy.lastRequestAt`.
- Unidad explícita de `netRxBps`/`netTxBps` (hoy se asume bytes/s).
