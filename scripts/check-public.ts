/**
 * Pre-push guard for the PUBLIC b-net repo.
 *
 *   node scripts/check-public.ts            # scan tracked files (working tree)
 *   node scripts/check-public.ts --history  # also scan every commit's diff
 *
 * Looks for: credential patterns, real Tailscale IPs / tailnet domains of THIS machine's
 * tailnet (read at runtime from `tailscale status --json`, never printed), real-looking
 * emails, private keys. Findings are printed MASKED (file:line + rule), never the value.
 * Exit code 1 when anything is found.
 */
import { execFileSync } from "node:child_process";

type Finding = { where: string; rule: string };

const run = (cmd: string, args: string[], maxBuffer = 512 * 1024 * 1024) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer, stdio: ["ignore", "pipe", "ignore"] });

/** Values from the real tailnet. Kept in memory only. */
function realTailnetValues(): string[] {
  try {
    const st = JSON.parse(run("tailscale", ["status", "--json"])) as {
      MagicDNSSuffix?: string;
      CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string };
      Self?: { TailscaleIPs?: string[]; DNSName?: string };
      Peer?: Record<string, { TailscaleIPs?: string[]; DNSName?: string }>;
    };
    const nodes = [st.Self ?? {}, ...Object.values(st.Peer ?? {})];
    const vals = new Set<string>();
    for (const n of nodes) {
      for (const ip of n.TailscaleIPs ?? []) vals.add(ip);
      if (n.DNSName) vals.add(n.DNSName.replace(/\.$/, ""));
    }
    for (const s of [st.MagicDNSSuffix, st.CurrentTailnet?.MagicDNSSuffix, st.CurrentTailnet?.Name]) if (s) vals.add(s);
    return [...vals].filter((v) => v.length >= 6);
  } catch {
    console.warn("check-public: tailscale not available; skipping real-tailnet comparison");
    return [];
  }
}

const PATTERNS: Array<[string, RegExp]> = [
  ["anthropic-key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["openai-key", /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ["tailscale-key", /tskey-[a-z]+-[A-Za-z0-9]{10,}/],
  ["github-token", /(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{20,}/],
  ["aws-key", /AKIA[0-9A-Z]{16}/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["jwt", /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  // tailnet domains other than the fake one used in fixtures
  ["tailnet-domain", /\b(?!tail0fake\b)[a-z0-9-]+\.ts\.net\b/],
  // emails, except reserved/example domains and known no-reply addresses
  ["email", /\b[A-Za-z0-9._%+-]+@(?!(example\.(com|org|net|invalid)|[a-z0-9.-]*\.invalid|users\.noreply\.github\.com)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];

/** Lines that are allowed to match (documented dummies in tests). */
const ALLOW = [/noreply@anthropic\.com/, /ZHVtbXlzaWduYXR1cmU/ /* base64("dummysignature") test JWT */];
/** A credential-looking match is treated as a test dummy when it carries an obvious marker. */
const DUMMY_MARKER = /(FAKE|fake|DUMMY|dummy|0123456789|abcdef|1234567890)/;
const CREDENTIAL_RULES = new Set(["anthropic-key", "openai-key", "tailscale-key", "github-token", "aws-key", "jwt"]);

function scanText(text: string, label: (lineNo: number) => string, real: string[], out: Finding[]) {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (ALLOW.some((a) => a.test(line))) return;
    for (const [rule, re] of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      if (CREDENTIAL_RULES.has(rule) && DUMMY_MARKER.test(m[0])) continue;
      out.push({ where: label(i + 1), rule });
    }
    for (const v of real) if (line.includes(v)) out.push({ where: label(i + 1), rule: "real-tailnet-value" });
  });
}

const real = realTailnetValues();
const findings: Finding[] = [];

const files = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean)
  .filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|sqlite)$/.test(f) && f !== "pnpm-lock.yaml");
for (const f of files) {
  let text: string;
  try { text = run("git", ["show", `:${f}`]); } catch { continue; }
  scanText(text, (n) => `${f}:${n}`, real, findings);
}

if (process.argv.includes("--history")) {
  const log = run("git", ["log", "--all", "-p", "--no-color", "--format=@@COMMIT %h", "--", ".", ":!pnpm-lock.yaml"]);
  let commit = "?";
  const added: string[] = [];
  for (const line of log.split("\n")) {
    if (line.startsWith("@@COMMIT ")) { commit = line.slice(9); continue; }
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(`${commit}\u0000${line.slice(1)}`);
  }
  for (const entry of added) {
    const [c, l] = entry.split("\u0000") as [string, string];
    scanText(l, () => `commit ${c}`, real, findings);
  }
  // commit metadata (author emails are expected; only check messages)
  scanText(run("git", ["log", "--all", "--format=%h %s %b"]), (n) => `commit-message line ${n}`, real, findings);
}

const uniq = [...new Map(findings.map((f) => [`${f.where}|${f.rule}`, f])).values()];
if (uniq.length) {
  console.error(`check-public: ${uniq.length} finding(s) (values masked):`);
  for (const f of uniq.slice(0, 50)) console.error(`  ${f.rule.padEnd(20)} ${f.where}`);
  process.exit(1);
}
console.log(`check-public: OK (${files.length} files${process.argv.includes("--history") ? " + history" : ""}, ${real.length} real tailnet values compared)`);
