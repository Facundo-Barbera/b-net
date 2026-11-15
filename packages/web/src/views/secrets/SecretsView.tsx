import type { SecretMeta } from "@bixku/core";
import { Badge, Callout, Card, EmptyState, PageHeader, RelativeTime, SecretsIcon, Stat, StatStrip, Table, toneForSecretStatus, useNow } from "../../components/index.ts";
import type { ViewProps } from "../../routes.tsx";
import { spanEs } from "../subscriptions/spanish.ts";
import "./secrets.css";

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
const STATUS_ORDER: SecretMeta["status"][] = ["ok", "expiring", "expired", "invalid", "unknown"];
const STORAGE_LABEL: Record<SecretMeta["storage"], string> = {
  "encrypted-file": "archivo cifrado",
  "systemd-creds": "systemd-creds",
  env: "variable de entorno",
};
/** Kinds that hold upstream credentials and must live on the hub machine (architecture §6.2). */
const UPSTREAM_KINDS: SecretMeta["kind"][] = ["oauth-token", "api-key"];

function RelCell({ iso, nowMs, future, empty = "—" }: { iso: string | null; nowMs: number; future?: boolean; empty?: string }) {
  if (!iso) return <span className="u-faint">{empty}</span>;
  const overdue = future && Date.parse(iso) <= nowMs;
  const format = future ? (v: string | number | Date, now: number) => `${overdue ? "venció" : "expira"} ${spanEs(v, now)}` : spanEs;
  return <RelativeTime value={iso} now={nowMs} format={format} className={overdue ? "u-danger" : undefined} />;
}

function Row({ s, hubMachineId, nowMs }: { s: SecretMeta; hubMachineId: string; nowMs: number }) {
  const misplaced = UPSTREAM_KINDS.includes(s.kind) && s.machineId !== hubMachineId;
  // Defensive: the contract guarantees 8 hex chars; never render more than that.
  const fingerprint = /^[0-9a-f]{8}$/.test(s.fingerprint) ? s.fingerprint : "—";
  return (
    <tr data-testid={`secret-row-${s.id}`} data-status={s.status}>
      <th scope="row">{s.label}</th>
      <td className="num">
        {s.provider ? s.provider : <span className="u-faint">—</span>}
        {s.accountId ? <div className="u-faint">{s.accountId}</div> : null}
      </td>
      <td className="u-nowrap">{STORAGE_LABEL[s.storage]}</td>
      <td className="num u-nowrap">
        {s.machineId}
        {misplaced ? (
          <>
            {" "}
            <Badge tone="warn" title="Las credenciales upstream deben vivir en la máquina del hub">
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
      <td className="u-nowrap u-muted"><RelCell iso={s.createdAt} nowMs={nowMs} /></td>
      <td className="u-nowrap u-muted"><RelCell iso={s.rotatedAt} nowMs={nowMs} empty="nunca" /></td>
      <td className="u-nowrap"><RelCell iso={s.expiresAt} nowMs={nowMs} future empty="sin vencimiento" /></td>
      <td className="u-nowrap u-muted"><RelCell iso={s.lastUsedAt} nowMs={nowMs} empty="nunca" /></td>
      <td>
        <Badge dot tone={toneForSecretStatus(s.status)}>{s.status}</Badge>
      </td>
    </tr>
  );
}

export function SecretsView({ snapshot }: ViewProps) {
  const nowMs = useNow();
  const secrets = snapshot.secrets;
  const groups = KIND_ORDER.map((kind) => ({ kind, items: secrets.filter((s) => s.kind === kind) })).filter((g) => g.items.length > 0);
  const count = (st: SecretMeta["status"]) => secrets.filter((s) => s.status === st).length;

  return (
    <section className="ui-view se" data-testid="view-secrets">
      <PageHeader title="Secrets" subtitle="Inventario de credenciales: solo metadatos" />

      <Callout tone="accent" role="note" data-testid="secrets-note" icon={<SecretsIcon />} className="se-note">
        <p>
          <strong>Los valores nunca se envían a la UI.</strong> Esta vista muestra únicamente metadatos y una huella de 8 hex
          (sha256 truncado). No existe forma de ver, copiar ni descargar un secreto desde aquí; rotarlos o volver a hacer login
          se hace en el proxy, en bixku-homelab.
        </p>
      </Callout>

      <StatStrip data-testid="secrets-summary">
        <Stat label="Secretos" value={secrets.length} hint={`${groups.length} tipos`} />
        {STATUS_ORDER.map((st) => (
          <Stat key={st} label={st} value={count(st)} tone={count(st) > 0 && st !== "ok" && st !== "unknown" ? toneForSecretStatus(st) : undefined} />
        ))}
      </StatStrip>

      {groups.length === 0 ? (
        <Card>
          <EmptyState data-testid="secrets-empty" title="Sin secretos" description="El proxy todavía no reporta metadatos de secretos." />
        </Card>
      ) : null}

      {groups.map((g) => (
        <Card key={g.kind} flush title={KIND_LABEL[g.kind]} actions={<span className="num u-muted">{g.items.length}</span>} data-testid={`secrets-group-${g.kind}`}>
          <Table className="se-table" aria-label={KIND_LABEL[g.kind]}>
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
          </Table>
        </Card>
      ))}
    </section>
  );
}
