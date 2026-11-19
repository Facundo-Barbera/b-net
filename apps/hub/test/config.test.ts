import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { botFromAuth, generateToken, hashToken } from "../src/bot-auth.ts";
import { ConfigError, loadHubConfig, parseBotTokens, withEnvFile } from "../src/config.ts";
import { machinesExample } from "./helpers.ts";

const files: Record<string, string> = {
  "config/machines.json": JSON.stringify(machinesExample),
  "/run/creds/beszel": "placeholder-from-file\n",
};
const read = (p: string) => {
  if (!(p in files)) throw new Error("ENOENT");
  return files[p]!;
};
const env = {
  HUB_LISTEN_HOST: "100.64.0.10",
  BESZEL_URL: "http://127.0.0.1:8090",
  BESZEL_EMAIL: "hub-readonly@example.invalid",
  BESZEL_PASSWORD: "placeholder",
  TAILSCALE_SOURCE: "localapi",
  T3_EXPORTERS: "http://bixku-vps:8781, http://bixku-mbp:8781/",
};

describe("config loader", () => {
  it("loads env + machines.json with defaults", () => {
    const c = loadHubConfig(env, read);
    expect(c.listenPort).toBe(8780);
    expect(c.hubMachineId).toBe("bixku-homelab");
    expect(c.machines).toHaveLength(6);
    expect(c.beszel?.password).toBe("placeholder");
    // exporters already declared as machines[].agentUrl are deduplicated
    expect(c.t3Exporters).toEqual(["http://bixku-mbp:8781"]);
    expect(c.proxy).toBeNull();
    expect(c.pollFastSec).toBe(15);
  });

  it("prefers *_FILE secrets and disables Beszel with placeholder password", () => {
    expect(loadHubConfig({ ...env, BESZEL_PASSWORD_FILE: "/run/creds/beszel" }, read).beszel?.password).toBe("placeholder-from-file");
    expect(loadHubConfig({ ...env, BESZEL_PASSWORD: "__CHANGE_ME__" }, read).beszel).toBeNull();
  });

  it("refuses to bind on all interfaces", () => {
    for (const h of ["0.0.0.0", "::", ""]) expect(() => loadHubConfig({ ...env, HUB_LISTEN_HOST: h }, read)).toThrow(ConfigError);
  });

  it("validates machines.json and other values", () => {
    files["bad.json"] = JSON.stringify([{ id: "Bad Id", name: "x" }]);
    expect(() => loadHubConfig({ ...env, HUB_MACHINES_FILE: "bad.json" }, read)).toThrow(/machines.json invalid/);
    files["dup.json"] = JSON.stringify([machinesExample[0], machinesExample[0]]);
    expect(() => loadHubConfig({ ...env, HUB_MACHINES_FILE: "dup.json" }, read)).toThrow(/duplicate/);
    expect(() => loadHubConfig({ ...env, TAILSCALE_SOURCE: "ssh" }, read)).toThrow(/TAILSCALE_SOURCE/);
    expect(() => loadHubConfig({ ...env, HUB_LISTEN_PORT: "99999" }, read)).toThrow(/HUB_LISTEN_PORT/);
    expect(() => loadHubConfig({ ...env, BESZEL_PASSWORD_FILE: "/missing" }, read)).toThrow(/BESZEL_PASSWORD_FILE/);
  });

  it("never puts secret values in error messages", () => {
    try {
      loadHubConfig({ ...env, HUB_PROXY_URL: "not a url", HUB_PROXY_TOKEN: "placeholder-secret" }, read);
    } catch (e) {
      expect(String(e)).not.toContain("placeholder-secret");
    }
  });
});

describe("env file", () => {
  it("fills in values from the file; the process environment wins", () => {
    const text = "# comment\nHUB_LISTEN_HOST=100.64.0.99\nHUB_LISTEN_PORT=8790\nBESZEL_EMAIL=\"from-file@example.invalid\"\n";
    const merged = withEnvFile({ HUB_LISTEN_HOST: "100.64.0.10" }, text);
    expect(merged.HUB_LISTEN_HOST).toBe("100.64.0.10");
    expect(merged.HUB_LISTEN_PORT).toBe("8790");
    expect(merged.BESZEL_EMAIL).toBe("from-file@example.invalid");
    expect(loadHubConfig({ ...merged, HUB_MACHINES_FILE: "config/machines.json" }, read).listenPort).toBe(8790);
  });

  it("parses the shipped .env.example", () => {
    const merged = withEnvFile({}, readFileSync(new URL("../../../.env.example", import.meta.url), "utf8"));
    expect(merged.HUB_LISTEN_PORT).toBe("8780");
    expect(merged.TAILSCALE_SOURCE).toBe("localapi");
  });
});

describe("bot tokens and deliverables quota", () => {
  const hash = "ab".repeat(32);
  const withFile = (content: string) => (p: string) => (p === "/etc/fhub/bot-tokens.json" ? content : read(p));
  const botEnv = { ...env, HUB_BOT_TOKENS_FILE: "/etc/fhub/bot-tokens.json" };

  it("defaults: no bots (nobody can write) and a 100 GiB quota", () => {
    const c = loadHubConfig(env, read);
    expect(c.botTokens).toEqual([]);
    expect(c.deliverablesQuotaBytes).toBe(100 * 1024 ** 3);
    expect(loadHubConfig({ ...env, HUB_DELIVERABLES_QUOTA_GB: "250" }, read).deliverablesQuotaBytes).toBe(250 * 1024 ** 3);
    expect(() => loadHubConfig({ ...env, HUB_DELIVERABLES_QUOTA_GB: "0" }, read)).toThrow(ConfigError);
  });

  it("loads hashed tokens per bot from the local file", () => {
    const c = loadHubConfig(botEnv, withFile(JSON.stringify({ bots: [{ name: "fstack-vps", tokenSha256: hash }] })));
    expect(c.botTokens).toEqual([{ name: "fstack-vps", tokenSha256: hash }]);
  });

  it("the example file parses", () => {
    const example = readFileSync(new URL("../../../config/bot-tokens.example.json", import.meta.url), "utf8");
    expect(parseBotTokens(JSON.parse(example))).toHaveLength(1);
  });

  it("rejects raw tokens, duplicate names, shared tokens and unreadable files", () => {
    const bad = (bots: unknown) => () => loadHubConfig(botEnv, withFile(JSON.stringify({ bots })));
    expect(bad([{ name: "a", token: "raw-secret" }])).toThrow(ConfigError);
    expect(bad([{ name: "a", tokenSha256: "short" }])).toThrow(/tokenSha256/);
    expect(bad([{ name: "a", tokenSha256: hash }, { name: "a", tokenSha256: "cd".repeat(32) }])).toThrow(/duplicate bot a/);
    expect(bad([{ name: "a", tokenSha256: hash }, { name: "b", tokenSha256: hash }])).toThrow(/reuses/);
    expect(() => loadHubConfig(botEnv, read)).toThrow(/HUB_BOT_TOKENS_FILE/);
    // Errors never echo the hash.
    try {
      bad([{ name: "a", tokenSha256: hash }, { name: "b", tokenSha256: hash }])();
    } catch (e) {
      expect(String(e)).not.toContain(hash);
    }
  });
});

describe("botFromAuth", () => {
  const bots = [{ name: "fstack-vps", tokenSha256: hashToken("placeholder-bot-token") }];
  it("maps a valid bearer token to its bot and nothing else", () => {
    expect(botFromAuth("Bearer placeholder-bot-token", bots)).toBe("fstack-vps");
    expect(botFromAuth("bearer placeholder-bot-token", bots)).toBe("fstack-vps");
    expect(botFromAuth("Bearer placeholder-bot-tokenX", bots)).toBeNull();
    expect(botFromAuth(`Bearer ${bots[0]!.tokenSha256}`, bots)).toBeNull(); // the stored hash is not a credential
    expect(botFromAuth(null, bots)).toBeNull();
    expect(botFromAuth("Bearer placeholder-bot-token", [])).toBeNull();
  });
  it("generated tokens are 256-bit base64url", () => {
    expect(generateToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
