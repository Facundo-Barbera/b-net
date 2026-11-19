# Agente (`packages/agent`) y cliente T3 (`packages/core/src/clients/t3`)

## Qué hay

- **Cliente T3** (`@fhub/core/clients/t3`): `readT3Threads({ machineId, dbPath? })` abre `~/.t3/userdata/statev2.sqlite` con `new DatabaseSync(path, { readOnly: true })` + `PRAGMA query_only=ON` y devuelve `{ threads: T3ThreadView[], health }`. `readT3ThreadsFromDb(db, …)` hace lo mismo sobre una base ya abierta (tests con SQLite en memoria).
- **Colector de métricas** (`src/metrics/`): parsers puros (`parsers.ts`) + `createCollector(deps)` con todo el I/O inyectado (`readFile`, `statfs`, `exec`, `os`, reloj). Anillo de historial `MetricHistoryBuffer` (30 puntos, `stepSec` 60 por defecto). `Sampler` guarda la última muestra y el historial; el timer vive solo en `serve.ts`.
- **Handler** `createAgentHandler(deps) => (req: Request) => Promise<Response>` para `AgentRoutes`. **Todas** las rutas (también `health`) exigen `Authorization: Bearer`, comparado en tiempo constante (sha256 de ambos + `timingSafeEqual`). Sin token configurado el constructor lanza (falla cerrado). 401 no ejecuta ningún trabajo (no lee métricas ni la base de T3).
- **`src/serve.ts`**: monta el handler en `node:http` sobre `AGENT_LISTEN_HOST`. **Nunca se ejecutó aquí.** Rechaza hosts wildcard (`0.0.0.0`, `::`), exige una IP literal y un token de ≥16 chars (`AGENT_TOKEN_FILE`, pensado para `LoadCredential` de systemd).
- **`deploy/`**: `b-net-agent.service.example` (systemd, endurecido, token por credencial) y `dev.b-net.agent.plist.example` (launchd). Solo ejemplos con placeholders `<…>` / `REPLACE_…`.

### Configuración (variables de entorno)

`AGENT_MACHINE_ID` (obligatoria, `[a-z0-9-]+`), `AGENT_LISTEN_HOST` (obligatoria, IP de Tailscale), `AGENT_TOKEN_FILE` (o `AGENT_TOKEN` solo para pruebas locales), `AGENT_PORT` (8781), `AGENT_T3_DB`, `AGENT_SAMPLE_SEC` (60), `AGENT_HISTORY_POINTS` (30).

## Decisiones

1. **Privacidad de T3**: el cliente nunca consulta tablas de mensajes/actividad/diffs. De `payload_json` solo extrae `modelSelection.model`, `branch` y `lineage.parentThreadId`. Hay un test que mete texto marcado en una tabla de mensajes y en `payload_json` y comprueba que no aparece en la salida.
2. **Derivación de estado** (prioridad): `archived` > `waiting` > `active` > `idle` > `dormant`.
   - `waiting` va **antes** que `active`: un run `running` bloqueado por una aprobación está esperando al humano.
   - `active` = último run (mayor `ordinal`) `running` **o** provider thread `active`.
   - `idle` = sesión más reciente `ready`; todo lo demás → `dormant`.
   - Se excluyen hilos con `deleted_at`.
   - Request pendiente = `resolved_at` nulo **y** `status` fuera de un conjunto de estados terminales conocidos (`resolved`, `approved`, `denied`, `cancelled`, `expired`, …).
3. **Deriva de versión de T3**: cada tabla/columna se introspecciona (`pragma_table_info`). Falta algo opcional → `health.degraded` lista qué faltó y el estado se deriva con lo que haya. Falta algo obligatorio (tabla de threads o sus columnas base), archivo ausente o DB corrupta → `[]` + `health.ok=false` con `reason` (`db_not_found | open_failed | schema_drift | query_failed`). Nunca lanza. `status` de run desconocido → `lastRunStatus: null` (no rompe el contrato).
4. **`t3Available`** en `/health` = `health.ok` de la última lectura (se vuelve a leer en cada `/health`; es barato).
5. **CPU**: deltas de `/proc/stat` entre muestras; la primera muestra devuelve el promedio desde el arranque. Red: tasa por delta de `/proc/net/dev` (suma de interfaces menos `lo`, `veth*`, `docker*`, `br-*`, `virbr*`); `null` en la primera muestra o si el contador se reinicia. Memoria Linux = `MemTotal − MemAvailable`. Disco `/` por `statfs` con la convención de `df` (excluye bloques reservados de root). Temperatura = zona térmica más caliente de `/sys/class/thermal` (`null` si no hay, p. ej. WSL).
6. **macOS**: `os.cpus()` (deltas), `vm_stat` para memoria (usada = total − libre − inactiva − especulativa − purgeable), `df -k /System/Volumes/Data` con fallback a `/` (en APFS `/` es el volumen de sistema de solo lectura y subestima el uso). Red y temperatura: `null` por ahora. Sin dependencias de binarios aparte de `vm_stat`/`df`, que corren con `execFile` sin shell y timeout de 5 s.
7. **WSL = Linux**: mismo camino por `/proc`. Ojo: dentro de WSL el disco `/` es el VHDX de la distro, no el disco de Windows, y RAM/CPU son los asignados a la VM.
8. **Sin dependencias nuevas.** El agente usa solo `node:*` y `@fhub/core`.
9. **El handler llena `machineId`** de cada hilo con el de la config (el cliente T3 ya lo recibe, pero el handler lo sobrescribe: la fuente de verdad es la config del agente).

## Preguntas abiertas para Facundo

1. **Windows nativo vs WSL** (PC): ¿el agente corre dentro de WSL (métricas de la VM, no del equipo; T3 de Windows queda fuera si corre en Windows) o hace falta un colector nativo (PowerShell/`os` + `wmic`/`Get-Counter`)? Propuesta: WSL ahora; si T3 de la PC corre en Windows, el agente debe poder apuntar a `AGENT_T3_DB=/mnt/c/Users/<user>/.t3/userdata/statev2.sqlite` (SQLite sobre 9p puede dar problemas de locking en solo lectura).
2. **¿T3 corre en cada máquina?** Si T3 solo corre en algunas, `t3Available=false` es lo esperado en las demás. ¿Confirmas dónde está T3 (vps, homelab, MBP/MBA, PC)?
3. **Request pendiente**: no conozco los valores reales de `runtime_requests.status`; uso `resolved_at` nulo + lista de estados terminales. Conviene validar con una base real que contenga requests resueltos y pendientes (no se inspeccionaron datos reales, solo el esquema).
4. **Runs `running` huérfanos**: si T3 se cierra a mitad de un run, el run puede quedar `running` para siempre y el hilo aparecería `active`. Propuesta: tratarlo como `dormant` cuando el último `updated_at` tenga más de N horas **y** la sesión esté `stopped`/`not_loaded`. No lo implementé porque cambia la regla de `architecture.md`.
5. **Frecuencia**: muestreo cada 60 s con 30 puntos = 30 min de historial. ¿Suficiente para los sparklines, o prefieres 5 s × 60 puntos para la UI de Machines?
6. **Disco**: solo `/`. ¿Hay máquinas con discos de datos adicionales que deban sumarse (p. ej. homelab)?
7. **Token por agente**: el hub necesitará un token distinto por agente. ¿Se generan con un script del hub o a mano en cada `systemd-creds`?

## Cambios de contrato propuestos (no aplicados: fuera de mi propiedad)

- `AgentHealth` podría llevar `t3Reason: string | null` (`db_not_found`, `schema_drift`…) para que la UI explique por qué no hay hilos; hoy solo hay el booleano `t3Available`. Opcional.
- `MachineMetrics` no distingue “sin dato” de 0 para `cpuPct/memPct/diskPct`. Si falla `/proc` y el colector cae al módulo `os`, o el disco no se pudo leer, devuelve 0 en disco. Propuesta: permitir `diskTotalGb: 0` como “sin dato” en la UI (ya es posible hoy) o volver `diskPct` nullable.
