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
| Agente (métricas push sin puerto + exportador T3 opcional) | Hecho, sin instalar en ninguna máquina | `packages/agent/src/`, `packages/agent/deploy/` |
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
| `packages/agent` | Agente ligero: empuja métricas al hub cada 30 s sin abrir puertos (+ exportador T3 opcional en modo pull) |
| `packages/web` | UI (React + Vite), temas claro y oscuro |

## Agente de métricas (push)

Cada máquina corre un agente que **no escucha en ningún puerto**. Cada 30 s lee CPU %, RAM, disco `/`, red rx/tx, load, uptime (más temperatura y GPU NVIDIA si las hay) y hace un `POST /ingest/v1/metrics` al hub. Linux lee `/proc` y `statfs`; macOS usa `os`, `vm_stat`, `df -k` y `netstat -ib`. Si el hub no responde, la muestra se descarta: no hay reintentos ni buffer, así la memoria no crece.

En el hub, cada máquina tiene su propio token y solo se guarda `sha256(token)`. Las muestras van al SQLite del hub (`$HUB_DATA_DIR/hub.sqlite`): crudo 24 h y promedio por 5 min durante 30 días. La limpieza la dispara la propia ingesta, como mucho una vez cada 5 min, y solo procesa los buckets nuevos. Para cada máquina, el hub usa las métricas del agente si tienen menos de 90 s; si no, las de Beszel (que sigue en paralelo); si tampoco hay, ninguna.

### Instalar en una máquina (sin sudo)

```bash
# 1. En el hub: generar el token (se muestra una sola vez; rotar = volver a ejecutar)
HUB_DATA_DIR=/var/lib/b-net node packages/hub/scripts/agent-token.ts issue bixku-mbp
#    revoke <id> lo invalida · list muestra las máquinas con token

# 2. En la máquina, desde un checkout del repo: pegar el token por stdin
packages/agent/deploy/install.sh --machine-id bixku-mbp --hub-url http://<hub-tailscale>:8780 < token.txt
#    opciones: --interval 30 · --runtime bun|node · --uninstall
```

- **Linux**: instala `~/.config/systemd/user/b-net-agent.service` (desde `packages/agent/deploy/b-net-agent.user.service`) con `Nice=19`, CPU e IO en clase `idle`, `MemoryHigh=64M`, `MemoryMax=128M` y `TasksMax=16`. Intenta `loginctl enable-linger` para que siga corriendo sin sesión abierta.
- **macOS**: instala `~/Library/LaunchAgents/dev.b-net.agent.plist` con `ProcessType=Background`, IO de baja prioridad y `Nice=15`. macOS no aplica un límite de RSS a los agentes de usuario.
- La configuración queda en `~/.config/b-net-agent/` (`env`, `token`, ambos con permisos 600). Los logs solo registran cambios de estado (`push failing: …` / `push recovered`) y nunca el token.
- **Runtime**: si existe `bun`, el script compila un binario (`bun build --compile`, en `~/.local/lib/b-net-agent/`). Es la opción más ligera en RAM: unos 30 MiB de RSS frente a unos 60 MiB con Node y un bundle de JS, y unos 78 MiB con Node ejecutando el `.ts`. Ocupa unos 109 MB en disco. Sin bun, usa `node ≥ 22.18` sobre `src/push.ts`.
- Medir el consumo real (solo Linux; el script termina solo y no deja procesos vivos): `node packages/agent/scripts/measure.ts --duration 300 --interval 30 -- ~/.local/lib/b-net-agent/b-net-agent`.

### GPU NVIDIA

Solo en Linux y WSL, y solo si existe `nvidia-smi` (en el `PATH`, `/usr/bin`, `/usr/local/bin` o `/usr/lib/wsl/lib`, que es donde lo pone WSL). La ruta se busca una vez al arrancar: en máquinas sin GPU no se lanza ningún proceso. Cada muestra ejecuta `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits` con un timeout de 2 s. Si falla o se cuelga, se salta 10 muestras (5 min) antes de volver a intentarlo. Con varias GPU se reportan en una sola entrada: uso y temperatura máximos, VRAM sumada. Para desactivarla: `AGENT_GPU=off` en `~/.config/b-net-agent/env`. La tarjeta de la máquina muestra una fila `GPU` solo cuando hay datos.

### WSL (pc-bixku)

En WSL corre el mismo agente de Linux. Detecta WSL (por `WSL_DISTRO_NAME` o `microsoft` en `/proc/sys/kernel/osrelease`) y manda `wslVm: true`, porque CPU, RAM, disco (el VHDX de la distro) y red son los de la VM, no los de Windows. La tarjeta lo indica con "WSL VM" en la fila `Metrics`.

- **Con systemd** (Ubuntu 24.04 en WSL lo trae activo en instalaciones nuevas: `[boot] systemd=true` en `/etc/wsl.conf`; activarlo requiere sudo y el script no lo hace): `install.sh` instala la misma unidad de usuario que en Linux.
- **Sin systemd**: `install.sh` deja `~/.local/lib/b-net-agent/run.sh`, que arranca el agente con `nice 19` e `ionice` idle, sin límite de memoria, y no lo inicia.
- **En los dos casos**, WSL apaga la VM cuando ninguna sesión de Windows la mantiene abierta. Sin permisos de administrador, crea en Windows `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\b-net-wsl.vbs` con una línea:
  - con systemd: `CreateObject("WScript.Shell").Run "wsl.exe -d Ubuntu-24.04 --exec sleep infinity", 0, False`
  - sin systemd: `CreateObject("WScript.Shell").Run "wsl.exe -d Ubuntu-24.04 --exec /home/<usuario>/.local/lib/b-net-agent/run.sh", 0, False`

  Se ejecuta oculto al iniciar sesión en Windows. Sin sesión de Windows iniciada no hay métricas de la PC.

`src/serve.ts` (modo pull, escucha en un puerto) queda solo para el exportador opcional de hilos T3. Las métricas no lo necesitan.

## Antes de cada push (repo público)

```bash
pnpm test && pnpm typecheck
pnpm check:public   # busca credenciales, IPs/dominios reales del tailnet (comparando con `tailscale status`) y emails reales en el árbol y el historial; nunca imprime los valores
```

Las fixtures usan solo datos falsos: IPs `100.64.0.0/10` inventadas, dominios `.invalid` y el tailnet `tail0fake`.

## Licencia

[MIT](LICENSE) © 2026 Facundo Barbera.
