/**
 * Canonical, realistic HubSnapshot fixture shared by hub tests and the web UI.
 * All data is FAKE: IPs are from 100.64.0.0/10 docs ranges, ids/fingerprints are invented.
 * Reference "now" is FIXTURE_NOW so timestamps stay deterministic.
 */
import type { HubSnapshot, UsageTotals, UsageRecord, MachineView, T3ThreadView } from "../index.ts";

export const FIXTURE_NOW = "2026-11-15T20:30:00.000Z";
const now = Date.parse(FIXTURE_NOW);
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const ahead = (min: number) => new Date(now + min * 60_000).toISOString();

const wave = (n: number, base: number, amp: number, phase = 0) =>
  Array.from({ length: n }, (_, i) => Math.max(0, Math.min(100, +(base + amp * Math.sin(i / 3 + phase) + ((i * 7) % 5) - 2).toFixed(1))));

const totals = (requests: number, inT: number, outT: number, cr: number, cw: number, cost: number): UsageTotals => ({
  requests,
  inputTokens: inT,
  outputTokens: outT,
  cacheReadTokens: cr,
  cacheWriteTokens: cw,
  costUsd: cost,
});
const zero = totals(0, 0, 0, 0, 0, 0);

const machine = (m: Partial<MachineView> & Pick<MachineView, "id" | "name" | "role" | "os">): MachineView => ({
  status: "online",
  tailscale: { ip: null, online: true, lastSeen: ago(0), latencyMs: null, path: "direct", relay: null },
  metrics: null,
  metricsSource: "beszel",
  metricsAt: ago(1),
  history: null,
  services: [],
  threadCounts: { active: 0, waiting: 0, idle: 0, dormant: 0 },
  notes: null,
  ...m,
});

const machines: MachineView[] = [
  machine({
    id: "bixku-homelab", name: "bixku-homelab", role: "hub", os: "linux",
    tailscale: { ip: "100.64.0.10", online: true, lastSeen: ago(0), latencyMs: 0, path: "self", relay: null },
    metrics: { cpuPct: 23.4, memPct: 71.2, memUsedGb: 5.3, memTotalGb: 7.5, diskPct: 48.1, diskUsedGb: 112, diskTotalGb: 233, load1: 0.92, netRxBps: 182_000, netTxBps: 96_000, uptimeSec: 1_904_400, tempC: 52 },
    history: { stepSec: 60, cpuPct: wave(30, 22, 8), memPct: wave(30, 70, 2) },
    services: [
      { name: "beszel-hub", port: 8090, status: "up" },
      { name: "cliproxyapi", port: 8317, status: "up" },
      { name: "bixku-proxy", port: 8318, status: "up" },
      { name: "bixku-hub", port: 8780, status: "up" },
    ],
    notes: "Mac mini con Ubuntu. Hub de Beszel, CLIProxyAPI y bixku-hub.",
  }),
  machine({
    id: "bixku-vps", name: "bixku-vps", role: "vps", os: "linux",
    tailscale: { ip: "100.64.0.20", online: true, lastSeen: ago(0), latencyMs: 148, path: "direct", relay: null },
    metrics: { cpuPct: 61.8, memPct: 54.0, memUsedGb: 12.9, memTotalGb: 23.9, diskPct: 63.5, diskUsedGb: 254, diskTotalGb: 400, load1: 3.1, netRxBps: 1_240_000, netTxBps: 880_000, uptimeSec: 864_000, tempC: null },
    history: { stepSec: 60, cpuPct: wave(30, 58, 15, 1), memPct: wave(30, 54, 3, 1) },
    threadCounts: { active: 2, waiting: 1, idle: 1, dormant: 3 },
    notes: "Contabo. Solo para escribir código.",
  }),
  machine({
    id: "bixku-focaltec", name: "Mac mini Focaltec", role: "workstation", os: "macos",
    tailscale: { ip: "100.64.0.30", online: true, lastSeen: ago(0), latencyMs: 12, path: "direct", relay: null },
    metrics: { cpuPct: 12.1, memPct: 66.3, memUsedGb: 10.6, memTotalGb: 16, diskPct: 71.0, diskUsedGb: 355, diskTotalGb: 500, load1: 1.8, netRxBps: 45_000, netTxBps: 21_000, uptimeSec: 302_400, tempC: null },
    history: { stepSec: 60, cpuPct: wave(30, 12, 5, 2), memPct: wave(30, 66, 1, 2) },
    threadCounts: { active: 1, waiting: 0, idle: 0, dormant: 2 },
  }),
  machine({
    id: "pc-bixku", name: "PC-BiXKu", role: "workstation", os: "wsl",
    status: "degraded",
    tailscale: { ip: "100.64.0.40", online: true, lastSeen: ago(0), latencyMs: 87, path: "derp", relay: "mia" },
    metrics: { cpuPct: 91.5, memPct: 88.7, memUsedGb: 28.4, memTotalGb: 32, diskPct: 92.3, diskUsedGb: 1846, diskTotalGb: 2000, load1: 7.4, netRxBps: 3_400_000, netTxBps: 210_000, uptimeSec: 51_000, tempC: 78 },
    history: { stepSec: 60, cpuPct: wave(30, 85, 10, 3), memPct: wave(30, 87, 2, 3) },
    metricsSource: "agent",
    threadCounts: { active: 0, waiting: 0, idle: 1, dormant: 1 },
    notes: "Windows + WSL. Disco casi lleno.",
  }),
  machine({
    id: "bixku-mbp", name: "MBP Omarchy", role: "laptop", os: "linux",
    status: "offline",
    tailscale: { ip: "100.64.0.50", online: false, lastSeen: ago(60 * 26), latencyMs: null, path: "unknown", relay: null },
    metrics: null, metricsSource: "none", metricsAt: null,
    threadCounts: { active: 0, waiting: 0, idle: 0, dormant: 1 },
  }),
  machine({
    id: "bixku-mba", name: "MBA", role: "laptop", os: "macos",
    status: "paused",
    tailscale: { ip: "100.64.0.60", online: true, lastSeen: ago(3), latencyMs: 34, path: "peer-relay", relay: null },
    metrics: null, metricsSource: "none", metricsAt: null,
    notes: "Sin agente ni Beszel todavía.",
  }),
];

const thread = (t: Partial<T3ThreadView> & Pick<T3ThreadView, "id" | "machineId" | "title" | "state">): T3ThreadView => ({
  projectTitle: "bixku-hub", provider: "claudeAgent", model: "claude-opus-5-5", branch: null,
  createdAt: ago(600), updatedAt: ago(30), lastRunStatus: "completed", runningSince: null, parentThreadId: null,
  ...t,
});

const threads: T3ThreadView[] = [
  thread({ id: "th_01", machineId: "bixku-vps", title: "bixku-hub fase 1 (coordinador)", state: "active", lastRunStatus: "running", runningSince: ago(14), updatedAt: ago(0) }),
  thread({ id: "th_02", machineId: "bixku-vps", title: "Proxy: pool de cuentas y failover", state: "active", lastRunStatus: "running", runningSince: ago(6), updatedAt: ago(1), parentThreadId: "th_01", branch: "feat/proxy" }),
  thread({ id: "th_03", machineId: "bixku-vps", title: "Revisar PR de dotfiles", state: "waiting", projectTitle: "dotfiles", updatedAt: ago(42), lastRunStatus: "completed" }),
  thread({ id: "th_04", machineId: "bixku-vps", title: "Migrar cron de backups", state: "idle", projectTitle: "homelab-ops", model: "claude-sonnet-5-5", updatedAt: ago(95) }),
  thread({ id: "th_05", machineId: "bixku-vps", title: "Notas de Tailscale ACL", state: "dormant", projectTitle: "homelab-ops", updatedAt: ago(60 * 30) }),
  thread({ id: "th_06", machineId: "bixku-vps", title: "Bot de Telegram: comandos", state: "dormant", projectTitle: "bixku-bot", provider: "codex", model: "gpt-5.5", updatedAt: ago(60 * 52), lastRunStatus: "failed" }),
  thread({ id: "th_07", machineId: "bixku-vps", title: "Refactor scripts fleet", state: "dormant", projectTitle: "fleet", updatedAt: ago(60 * 80), lastRunStatus: "interrupted" }),
  thread({ id: "th_08", machineId: "bixku-focaltec", title: "API de trabajo: validaciones", state: "active", projectTitle: "work-api", lastRunStatus: "running", runningSince: ago(3), updatedAt: ago(0), branch: "fix/validations" }),
  thread({ id: "th_09", machineId: "bixku-focaltec", title: "Migración Postgres 17", state: "dormant", projectTitle: "work-api", updatedAt: ago(60 * 20) }),
  thread({ id: "th_10", machineId: "bixku-focaltec", title: "Spike: extracción de PDFs", state: "dormant", projectTitle: "work-spike", provider: "cursor", model: null, updatedAt: ago(60 * 140) }),
  thread({ id: "th_11", machineId: "pc-bixku", title: "Juego Godot: inventario", state: "idle", projectTitle: "godot-rpg", model: "claude-sonnet-5-5", updatedAt: ago(180) }),
  thread({ id: "th_12", machineId: "pc-bixku", title: "Limpiar disco D:", state: "dormant", projectTitle: "pc-maint", updatedAt: ago(60 * 47) }),
  thread({ id: "th_13", machineId: "bixku-mbp", title: "Omarchy: hyprland config", state: "dormant", projectTitle: "dotfiles", updatedAt: ago(60 * 27) }),
  thread({ id: "th_14", machineId: "bixku-mbp", title: "Charla meetup: slides", state: "archived", projectTitle: "talks", updatedAt: ago(60 * 200) }),
];

const accounts: HubSnapshot["accounts"] = [
  {
    id: "anthropic-max-1", provider: "anthropic", label: "Claude Max · personal", plan: "Claude Max 20x", planPriceUsd: 200,
    authKind: "oauth-subscription", poolState: "active", cooldownUntil: null, priority: 0, lastUsedAt: ago(0), lastError: null,
    windows: [
      { kind: "5h", scope: null, startedAt: ago(170), resetsAt: ahead(130), usedPct: 64, source: "provider-headers", totals: totals(412, 9_820_000, 610_000, 81_400_000, 2_150_000, 118.42) },
      { kind: "weekly", scope: null, startedAt: ago(60 * 24 * 3), resetsAt: ahead(60 * 24 * 4 + 200), usedPct: 41, source: "provider-headers", totals: totals(2_910, 61_000_000, 4_300_000, 512_000_000, 14_800_000, 791.3) },
      { kind: "weekly", scope: "opus", startedAt: ago(60 * 24 * 3), resetsAt: ahead(60 * 24 * 4 + 200), usedPct: 57, source: "provider-headers", totals: totals(1_850, 44_000_000, 3_100_000, 390_000_000, 11_000_000, 640.1) },
    ],
    credits: null,
    today: totals(690, 15_100_000, 980_000, 129_000_000, 3_300_000, 182.7),
    last7d: totals(4_020, 83_000_000, 5_900_000, 701_000_000, 19_900_000, 1_066.5),
    last30d: totals(15_480, 301_000_000, 22_400_000, 2_610_000_000, 72_000_000, 3_980.2),
  },
  {
    id: "anthropic-max-2", provider: "anthropic", label: "Claude Max · trabajo", plan: "Claude Max 5x", planPriceUsd: 100,
    authKind: "oauth-subscription", poolState: "cooldown", cooldownUntil: ahead(38), priority: 1, lastUsedAt: ago(22), lastError: "429 rate_limit_error (5h window exhausted)",
    windows: [
      { kind: "5h", scope: null, startedAt: ago(262), resetsAt: ahead(38), usedPct: 100, source: "provider-headers", totals: totals(198, 4_100_000, 260_000, 30_200_000, 900_000, 46.9) },
      { kind: "weekly", scope: null, startedAt: ago(60 * 24 * 5), resetsAt: ahead(60 * 24 * 2), usedPct: 83, source: "provider-headers", totals: totals(1_302, 25_000_000, 1_700_000, 196_000_000, 5_100_000, 301.8) },
    ],
    credits: null,
    today: totals(240, 5_000_000, 310_000, 37_000_000, 1_100_000, 57.2),
    last7d: totals(1_402, 27_100_000, 1_840_000, 210_000_000, 5_500_000, 324.6),
    last30d: totals(5_100, 96_000_000, 6_700_000, 780_000_000, 20_000_000, 1_201.0),
  },
  {
    id: "openai-pro-1", provider: "openai", label: "ChatGPT Pro · Codex", plan: "ChatGPT Pro", planPriceUsd: 200,
    authKind: "oauth-subscription", poolState: "active", cooldownUntil: null, priority: 0, lastUsedAt: ago(9), lastError: null,
    windows: [
      { kind: "5h", scope: null, startedAt: ago(40), resetsAt: ahead(260), usedPct: 12, source: "provider-headers", totals: totals(37, 1_900_000, 140_000, 6_800_000, 0, 9.85) },
      { kind: "weekly", scope: null, startedAt: ago(60 * 24), resetsAt: ahead(60 * 24 * 6), usedPct: 9, source: "provider-headers", totals: totals(121, 6_100_000, 520_000, 22_000_000, 0, 33.4) },
    ],
    credits: null,
    today: totals(51, 2_500_000, 190_000, 9_000_000, 0, 13.1),
    last7d: totals(310, 14_200_000, 1_200_000, 51_000_000, 0, 78.9),
    last30d: totals(1_020, 47_000_000, 3_900_000, 166_000_000, 0, 256.0),
  },
  {
    id: "anthropic-api-1", provider: "anthropic", label: "Anthropic API · standby", plan: "API pay-as-you-go", planPriceUsd: 0,
    authKind: "api-key", poolState: "standby", cooldownUntil: null, priority: 9, lastUsedAt: ago(60 * 30), lastError: null,
    windows: [
      { kind: "monthly", scope: null, startedAt: ago(60 * 24 * 14), resetsAt: ahead(60 * 24 * 16), usedPct: null, source: "estimated", totals: totals(84, 1_200_000, 90_000, 4_400_000, 300_000, 8.74) },
    ],
    credits: { currency: "USD", balance: 41.26, granted: 50, spent: 8.74, expiresAt: ahead(60 * 24 * 200), source: "manual", updatedAt: ago(60 * 24 * 2) },
    today: zero,
    last7d: totals(12, 180_000, 14_000, 600_000, 40_000, 1.32),
    last30d: totals(84, 1_200_000, 90_000, 4_400_000, 300_000, 8.74),
  },
  {
    id: "openrouter-1", provider: "openrouter", label: "OpenRouter · créditos", plan: "Créditos prepagados", planPriceUsd: 0,
    authKind: "api-key", poolState: "disabled", cooldownUntil: null, priority: 10, lastUsedAt: ago(60 * 24 * 9), lastError: null,
    windows: [],
    credits: { currency: "USD", balance: 12.5, granted: 25, spent: 12.5, expiresAt: null, source: "provider-api", updatedAt: ago(60 * 6) },
    today: zero, last7d: zero,
    last30d: totals(40, 900_000, 70_000, 0, 0, 2.11),
  },
];

const recent: UsageRecord[] = Array.from({ length: 12 }, (_, i) => {
  const acct = i % 5 === 3 ? "openai-pro-1" : "anthropic-max-1";
  const isOpenAI = acct === "openai-pro-1";
  const failed = i === 4;
  return {
    id: `01JCX${String(9_000_000 - i).padStart(21, "0")}`.slice(0, 26),
    ts: ago(i * 2 + 0.2),
    durationMs: 1800 + ((i * 1371) % 25000),
    ttftMs: 400 + ((i * 97) % 900),
    clientId: ["t3-vps", "opencode-mbp", "bot-telegram"][i % 3]!,
    format: isOpenAI ? "openai-responses" : "anthropic-messages",
    provider: isOpenAI ? "openai" : "anthropic",
    accountId: acct,
    model: isOpenAI ? "gpt-5.5" : i % 4 === 1 ? "claude-sonnet-5-5" : "claude-opus-5-5",
    requestedModel: isOpenAI ? "gpt-5.5" : i % 4 === 1 ? "claude-sonnet-5-5" : "claude-opus-5-5",
    stream: true,
    status: failed ? 429 : 200,
    outcome: failed ? "rate-limited" : "ok",
    failedOver: i === 2 ? ["anthropic-max-2"] : [],
    inputTokens: failed ? 0 : 3_000 + i * 811,
    outputTokens: failed ? 0 : 400 + i * 97,
    cacheReadTokens: failed ? 0 : 60_000 + i * 4_000,
    cacheWriteTokens: failed ? 0 : 1_200,
    reasoningTokens: isOpenAI ? 220 : 0,
    costUsd: failed ? 0 : +(0.02 + i * 0.013).toFixed(4),
  };
});

export const snapshotFixture: HubSnapshot = {
  generatedAt: FIXTURE_NOW,
  hubVersion: "0.1.0-fixture",
  hubMachineId: "bixku-homelab",
  sources: [
    { source: "beszel", machineId: null, ok: true, lastSuccessAt: ago(0.5), error: null },
    { source: "tailscale", machineId: null, ok: true, lastSuccessAt: ago(0.2), error: null },
    { source: "proxy", machineId: null, ok: true, lastSuccessAt: ago(0.3), error: null },
    { source: "t3", machineId: "bixku-vps", ok: true, lastSuccessAt: ago(0.4), error: null },
    { source: "t3", machineId: "bixku-focaltec", ok: true, lastSuccessAt: ago(0.4), error: null },
    { source: "agent", machineId: "pc-bixku", ok: true, lastSuccessAt: ago(0.6), error: null },
    { source: "t3", machineId: "bixku-mbp", ok: false, lastSuccessAt: ago(60 * 26), error: "agent unreachable (timeout 3s)" },
  ],
  machines,
  threads,
  accounts,
  proxy: {
    version: "0.1.0",
    listen: "100.64.0.10:8318",
    startedAt: ago(60 * 24 * 2),
    legacyProxy: { name: "CLIProxyAPI", listen: "100.64.0.10:8317", retired: false },
    lastHour: { requests: 236, errors: 4, rateLimited: 3, failovers: 2, p50Ms: 6400, p95Ms: 41200, costUsd: 38.9 },
    routes: [
      { match: "claude-*", provider: "anthropic", upstreamModel: null, accounts: ["anthropic-max-1", "anthropic-max-2", "anthropic-api-1"] },
      { match: "gpt-*", provider: "openai", upstreamModel: null, accounts: ["openai-pro-1"] },
      { match: "opus", provider: "anthropic", upstreamModel: "claude-opus-5-5", accounts: [] },
    ],
    clients: [
      { id: "t3-vps", label: "T3 Code · bixku-vps", createdAt: ago(60 * 24 * 3), lastUsedAt: ago(0), allowedModels: [], migration: "bixku-proxy" },
      { id: "opencode-mbp", label: "opencode · MBP", createdAt: ago(60 * 24 * 3), lastUsedAt: ago(4), allowedModels: ["claude-*"], migration: "both" },
      { id: "bot-telegram", label: "Bot de Telegram", createdAt: ago(60 * 24 * 3), lastUsedAt: ago(2), allowedModels: ["claude-sonnet-*", "gpt-*"], migration: "cliproxyapi" },
    ],
    recent,
  },
  secrets: [
    { id: "sec-anthropic-max-1", kind: "oauth-token", label: "Claude Max · personal", provider: "anthropic", accountId: "anthropic-max-1", storage: "encrypted-file", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 20), rotatedAt: ago(60 * 7), expiresAt: ahead(60 * 7), lastUsedAt: ago(0), fingerprint: "3fa9c1d2", status: "ok" },
    { id: "sec-anthropic-max-2", kind: "oauth-token", label: "Claude Max · trabajo", provider: "anthropic", accountId: "anthropic-max-2", storage: "encrypted-file", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 20), rotatedAt: ago(60 * 2), expiresAt: ahead(30), lastUsedAt: ago(22), fingerprint: "a07e44b9", status: "expiring" },
    { id: "sec-openai-pro-1", kind: "oauth-token", label: "ChatGPT Pro · Codex", provider: "openai", accountId: "openai-pro-1", storage: "encrypted-file", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 12), rotatedAt: ago(60 * 24), expiresAt: ahead(60 * 24 * 9), lastUsedAt: ago(9), fingerprint: "c4d1e8f0", status: "ok" },
    { id: "sec-anthropic-api-1", kind: "api-key", label: "Anthropic API key", provider: "anthropic", accountId: "anthropic-api-1", storage: "encrypted-file", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 60), rotatedAt: null, expiresAt: null, lastUsedAt: ago(60 * 30), fingerprint: "9b2266aa", status: "ok" },
    { id: "sec-openrouter-1", kind: "api-key", label: "OpenRouter key", provider: "openrouter", accountId: "openrouter-1", storage: "encrypted-file", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 90), rotatedAt: null, expiresAt: null, lastUsedAt: ago(60 * 24 * 9), fingerprint: "5e10d7c3", status: "unknown" },
    { id: "sec-client-t3-vps", kind: "client-key", label: "Client key · t3-vps", provider: null, accountId: null, storage: "encrypted-file", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 3), rotatedAt: null, expiresAt: null, lastUsedAt: ago(0), fingerprint: "e2b7f019", status: "ok" },
    { id: "sec-master", kind: "master-key", label: "Llave maestra del secret store", provider: null, accountId: null, storage: "systemd-creds", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 20), rotatedAt: null, expiresAt: null, lastUsedAt: ago(60 * 24 * 2), fingerprint: "00c0ffee", status: "ok" },
    { id: "sec-beszel-ro", kind: "service-password", label: "Beszel · usuario solo lectura", provider: null, accountId: null, storage: "env", machineId: "bixku-homelab", createdAt: ago(60 * 24 * 20), rotatedAt: null, expiresAt: null, lastUsedAt: ago(0.5), fingerprint: "71aa0c3e", status: "ok" },
  ],
};
