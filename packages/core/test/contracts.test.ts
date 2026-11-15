import { describe, expect, it } from "vitest";
import { HubSnapshot, SecretMeta, snapshotFixture } from "../src/index.ts";

describe("shared contracts", () => {
  it("the canonical snapshot fixture validates against HubSnapshot", () => {
    const r = HubSnapshot.safeParse(snapshotFixture);
    if (!r.success) console.error(r.error.issues.slice(0, 5));
    expect(r.success).toBe(true);
  });

  it("thread counts per machine match the threads list (non-archived)", () => {
    for (const m of snapshotFixture.machines) {
      const ts = snapshotFixture.threads.filter((t) => t.machineId === m.id);
      for (const s of ["active", "waiting", "idle", "dormant"] as const) {
        expect(ts.filter((t) => t.state === s).length, `${m.id}.${s}`).toBe(m.threadCounts[s]);
      }
    }
  });

  it("SecretMeta rejects any extra field (no way to smuggle a value)", () => {
    const meta = snapshotFixture.secrets[0]!;
    expect(SecretMeta.safeParse({ ...meta, value: "x" }).success).toBe(false);
  });
});
