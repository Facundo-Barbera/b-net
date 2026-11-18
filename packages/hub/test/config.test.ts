import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError, loadHubConfig, withEnvFile } from "../src/config.ts";
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
