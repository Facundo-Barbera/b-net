# Preguntas abiertas para Facundo

Las decisiones de producto quedan como **propuesta**; nada de esto está fijado. Las secciones por área se consolidan desde `docs/notes/*.md`.

## Producto

1. **Nombre final.** Propuesta de trabajo: `bixku-hub` (hub) y `bixku-proxy` (proxy). Alternativas: `bixku-deck`, `strawhat-lite`. ¿Te quedas con estos?
2. **Stack del proxy.** Propuesta: TypeScript (ver `architecture.md §5`). ¿Prefieres Go para tener un único binario y menos RAM en el homelab (7.5 GB)?
3. **Puertos.** Propuesta: hub `:8780`, proxy `:8318` (junto a CLIProxyAPI `:8317`), agentes `:8781`. ¿Hay conflictos con servicios existentes en el homelab?

## CLIProxyAPI (no se tocó la instancia real)

4. ¿Qué versión de CLIProxyAPI corre en el homelab? (la investigada es v8.0.73). ¿Usas config v8 o legacy?
5. ¿Qué proveedores y cuentas tiene cargados (Claude Code OAuth, Codex, Gemini/Antigravity, API keys, OpenRouter…)? ¿Cuántas cuentas hay por proveedor?
6. ¿Qué clientes apuntan hoy a CLIProxyAPI (T3 en qué máquinas, opencode, el bot, otros) y qué formato usa cada uno (OpenAI chat, Responses, Anthropic Messages)?
7. ¿Usas aliases o prefijos de modelo, sufijos de razonamiento `modelo(high)`, reglas de payload o `request-scoped-errors`? Hay que replicarlos o mapearlos.
8. ¿Usas la Management Center UI o `/usage-queue` para algo que hoy dependa de CLIProxyAPI?
9. **Términos de servicio.** Usar suscripciones (Claude Max, ChatGPT Pro) a través de un proxy y desde clientes que no son los oficiales puede ir contra los términos del proveedor. CLIProxyAPI incluso hace "cloaking" para Claude. **Propuesta: bixku-proxy no implementa cloaking ni suplanta clientes.** Se limita a reenviar las peticiones de clientes oficiales (Claude Code, Codex) y a usar API keys para el resto. ¿De acuerdo?

## Fuentes de datos

10. **Beszel**: ¿qué versión? ¿Puedes crear un usuario de solo lectura para el hub? (los campos abreviados de `systems.info` se infirieron del código público; hay que validarlos contra tu instancia).
11. **T3 por máquina**: ¿T3 corre también en el homelab? Para los hilos de otras máquinas, la propuesta es el agente con el exportador T3 de solo lectura. ¿O prefieres usar los "linked environments" de T3?
12. **Latencia**: ¿se mide desde el homelab (hub) hacia cada nodo, o quieres una matriz completa entre todos? La propuesta es solo desde el hub.
13. **Ventanas 5 h/semanales**: los headers de rate-limit de las suscripciones (Anthropic `anthropic-ratelimit-unified-*`, Codex `x-codex-*`) no están documentados públicamente. Se parsean de forma tolerante. ¿Tienes ejemplos reales (sin tokens) para validar?
14. **Créditos de pago por uso**: ¿qué cuentas tienen saldo prepagado y cuáles de ellas tienen API para consultarlo? Si no tienen API, el saldo se ingresa a mano.

## Seguridad

15. **Llave maestra del secret store**: la propuesta es `systemd-creds` (cifrada con TPM o la llave del host). ¿El homelab tiene TPM? Alternativas: `age` con llave en un USB, o el keyring del sistema.
16. ¿Activamos ACLs de Tailscale para limitar quién llega al hub y al proxy?
