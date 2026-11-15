# b-net

Hub propio del homelab: mapa de máquinas (Tailscale + Beszel/agente), hilos de T3 por máquina, suscripciones y consumo de IA, y un proxy de modelos propio que reemplaza a CLIProxyAPI.

- Arquitectura: [`docs/architecture.md`](docs/architecture.md)
- Paridad con CLIProxyAPI: [`docs/cliproxyapi-parity.md`](docs/cliproxyapi-parity.md)
- Preguntas abiertas: [`docs/open-questions.md`](docs/open-questions.md)

## Estado de la fase 1

| Área | Estado | Dónde |
|---|---|---|
| Contratos y fixture | Hecho | `packages/core/src/contracts/`, `packages/core/src/fixtures/snapshot.ts` |
| Clientes Beszel / Tailscale / T3 | Hecho, probados con fixtures falsas | `packages/core/src/clients/{beszel,tailscale,t3}/` |
| Hub (API + agregación) | Hecho, nunca ejecutado como servicio | `packages/hub/src/` (`serve.ts` sin correr) |
| Proxy (pool, cooldown, failover, medición) | Hecho, sin traducción entre formatos ni refresh OAuth | `packages/proxy/src/`, `config/proxy.example.json` |
| Agente (métricas + T3 solo lectura) | Hecho | `packages/agent/src/`, `packages/agent/deploy/` (ejemplos) |
| UI (Machines, Subscriptions, Proxy, Secrets; temas claro/oscuro) | Hecho con fixtures, verificada con build y tests de componentes | `packages/web/src/` |

Las notas por área están en `docs/notes/`. Las decisiones pendientes, en `docs/open-questions.md`.

## Requisitos

- Node ≥ 22.18 (type stripping nativo) y pnpm 10.

## Pruebas

```bash
pnpm install
pnpm test          # vitest: proyectos "node" (core, proxy, hub, agent) y "web" (jsdom)
pnpm typecheck     # tsc -b sobre todo el monorepo
pnpm --filter @b-net/web build   # compila la UI a packages/web/dist/app (no levanta servidor)
```

Todas las pruebas corren contra fixtures. No abren puertos ni tocan la red.

## Paquetes

| Paquete | Qué es |
|---|---|
| `packages/core` | Contratos compartidos (zod), fixture canónico `snapshotFixture`, clientes tipados |
| `packages/hub` | API `/api/v1` + agregación de fuentes |
| `packages/proxy` | Proxy OpenAI/Anthropic con pool de cuentas y medición |
| `packages/agent` | Agente ligero opcional (métricas + exportador T3 de solo lectura) |
| `packages/web` | UI (React + Vite), temas claro y oscuro |

## Antes de cada push (repo público)

```bash
pnpm test && pnpm typecheck
pnpm check:public   # busca credenciales, IPs/dominios reales del tailnet (comparando con `tailscale status`) y emails reales en el árbol y el historial; nunca imprime los valores
```

Las fixtures usan solo datos falsos: IPs `100.64.0.0/10` inventadas, dominios `.invalid` y el tailnet `tail0fake`.
