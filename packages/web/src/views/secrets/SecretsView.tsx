import type { SecretMeta } from "@bixku/core";
import type { ViewProps } from "../../routes.tsx";
import { fmtRel, resolveNow } from "../subscriptions/_shared/format.ts";
import type { NowInput } from "../subscriptions/_shared/format.ts";
import { Badge, Kpi, LockIcon, Panel, Time } from "../subscriptions/_shared/ui.tsx";
import type { Tone } from "../subscriptions/_shared/ui.tsx";
import "./secrets.css";

export interface SecretsViewProps extends ViewProps {
  /** Reference clock for relative times. Defaults to `snapshot.generatedAt`. */
  now?: NowInput;
}

/**
 * METADATA ONLY. Every cell below is read from a named SecretMeta field; the row is never spread
 * or serialised, and there is no input, reveal, copy or download control anywhere in this view.
 */
const KIND_ORDER: SecretMeta["kind"][] = ["oauth-token", "api-key", "client-key", "master-key", "service-password", "service-token"];
const KIND_LABEL: Record<SecretMeta["kind"], string> = {
  "oauth-token": "Tokens OAuth",
  "api-key": "API keys",
  "client-key": "Llaves de cliente",
  "master-key": "Llave maestra",
  "service-password": "Contraseñas de servicio",
  "service-token": "Tokens de servicio",
};
const STATUS_TONE: Record<SecretMeta["status"], Tone> = { ok: "ok", expiring: "warn", expired: "danger", invalid: "danger", unknown: "idle" };
const STATUS_ORDER: SecretMeta["status"][] = ["ok", "expiring", "expired", "invalid", "unknown"];
const STORAGE_LABEL: Record<SecretMeta["storage"], string> = {
  "encrypted-file": "archivo cifrado",
  "systemd-creds": "systemd-creds",
  env: "variable de entorno",
};
/** Kinds that hold upstream credentials and must live on the hub machine (architecture §6.2). */
const UPSTREAM_KINDS: SecretMeta["kind"][] = ["oauth-token", "api-key"];

function RelCell({ iso, nowMs, future, empty = "—" }: { iso: string | null; nowMs: number; future?: boolean; empty?: string }) {
  if (!iso) return <span className="vx-faint">{empty}</span>;
  const rel = fmtRel(iso, nowMs);
  const overdue = future && Date.parse(iso) <= nowMs;
  return (
    <Time iso={iso}>
      <span className={overdue ? "vx-danger-text" : undefined}>{future ? (overdue ? `venció ${rel}` : `expira ${rel}`) : rel}</span>
    </Time>
  );
}

function Row({ s, hubMachineId, nowMs }: { s: SecretMeta; hubMachineId: string; nowMs: number }) {
  const misplaced = UPSTREAM_KINDS.includes(s.kind) && s.machineId !== hubMachineId;
  // Defensive: the contract guarantees 8 hex chars; never render more than that.
  const fingerprint = /^[0-9a-f]{8}$/.test(s.fingerprint) ? s.fingerprint : "—";
  return (
    <tr data-testid={`secret-row-${s.id}`} data-status={s.status}>
      <th scope="row" className="se-label">
        {s.label}
      </th>
      <td className="vx-mono">
        {s.provider ? s.provider : <span className="vx-faint">—</span>}
        {s.accountId ? <div className="vx-faint">{s.accountId}</div> : null}
      </td>
      <td className="vx-nowrap">{STORAGE_LABEL[s.storage]}</td>
      <td className="vx-mono vx-nowrap">
        {s.machineId}
        {misplaced ? (
          <>
            {" "}
            <Badge tone="warn" dot={false} title="Las credenciales upstream deben vivir en la máquina del hub">
              fuera del hub
            </Badge>
          </>
        ) : null}
      </td>
      <td>
        <code className="se-fp" aria-label="Huella sha256 (8 hex)">
          {fingerprint}
        </code>
      </td>
      <td className="vx-nowrap vx-muted"><RelCell iso={s.createdAt} nowMs={nowMs} /></td>
      <td className="vx-nowrap vx-muted"><RelCell iso={s.rotatedAt} nowMs={nowMs} empty="nunca" /></td>
      <td className="vx-nowrap"><RelCell iso={s.expiresAt} nowMs={nowMs} future empty="sin vencimiento" /></td>
      <td className="vx-nowrap vx-muted"><RelCell iso={s.lastUsedAt} nowMs={nowMs} empty="nunca" /></td>
      <td>
        <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
      </td>
    </tr>
  );
}

export function SecretsView({ snapshot, now }: SecretsViewProps) {
  const nowMs = resolveNow(snapshot.generatedAt, now);
  const secrets = snapshot.secrets;
  const groups = KIND_ORDER.map((kind) => ({ kind, items: secrets.filter((s) => s.kind === kind) })).filter((g) => g.items.length > 0);
  const count = (st: SecretMeta["status"]) => secrets.filter((s) => s.status === st).length;

  return (
    <section className="vx se" data-testid="view-secrets">
      <div className="vx-page-head">
        <h1>Secrets</h1>
        <span className="vx-page-sub">Inventario de credenciales: solo metadatos</span>
      </div>

      <div className="se-note" role="note" data-testid="secrets-note">
        <LockIcon />
        <p>
          <strong>Los valores nunca se envían a la UI.</strong> Esta vista muestra únicamente metadatos y una huella de 8 hex
          (sha256 truncado). No existe forma de ver, copiar ni descargar un secreto desde aquí; rotarlos o volver a hacer login
          se hace en el proxy, en bixku-homelab.
        </p>
      </div>

      <div className="vx-kpis" data-testid="secrets-summary">
        <Kpi label="Secretos" value={secrets.length} sub={`${groups.length} tipos`} />
        {STATUS_ORDER.map((st) => (
          <Kpi key={st} label={st} value={count(st)} tone={count(st) > 0 && st !== "ok" && st !== "unknown" ? STATUS_TONE[st] : undefined} />
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="vx-empty" data-testid="secrets-empty">
          <h2 className="vx-eyebrow">Sin secretos</h2>
          <p>El proxy todavía no reporta metadatos de secretos.</p>
        </div>
      ) : null}

      {groups.map((g) => (
        <Panel key={g.kind} title={KIND_LABEL[g.kind]} aside={<span className="num">{g.items.length}</span>} testId={`secrets-group-${g.kind}`}>
          <div className="vx-table-wrap">
            <table className="vx-table se-table" aria-label={KIND_LABEL[g.kind]}>
              <thead>
                <tr>
                  <th scope="col">Etiqueta</th>
                  <th scope="col">Proveedor / cuenta</th>
                  <th scope="col">Almacén</th>
                  <th scope="col">Máquina</th>
                  <th scope="col">Huella</th>
                  <th scope="col">Creado</th>
                  <th scope="col">Rotado</th>
                  <th scope="col">Vence</th>
                  <th scope="col">Último uso</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((s) => (
                  <Row key={s.id} s={s} hubMachineId={snapshot.hubMachineId} nowMs={nowMs} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </section>
  );
}
