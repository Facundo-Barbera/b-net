import type { SecretMeta } from "@b-net/core";
import type { ClientAuth } from "./clients.ts";
import type { AccountConfig, ProxyConfig } from "./config.ts";
import type { AccountPool } from "./pool.ts";
import type { PricingTable } from "./pricing.ts";
import type { Logger } from "./redact.ts";
import type { RecordStore } from "./store/records.ts";
import type { Clock, UlidFactory } from "./util.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Returns the upstream credential (API key or OAuth access token) for an account. */
export type CredentialProvider = (account: AccountConfig) => Promise<string>;

export interface ProxyDeps {
  config: ProxyConfig;
  pool: AccountPool;
  store: RecordStore;
  clients: ClientAuth;
  credentials: CredentialProvider;
  fetch: FetchLike;
  clock: Clock;
  ids: UlidFactory;
  logger: Logger;
  pricing?: PricingTable;
  version: string;
  startedAt: number;
  /** Bearer token the hub uses for /internal/v1/*. */
  adminToken: string;
  secrets: { listMeta(): SecretMeta[] };
}

export type Handler = (req: Request) => Promise<Response>;
