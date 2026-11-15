export { createAgentHandler, safeEqual, type AgentHandlerDeps } from "./handler.ts";
export { loadConfig, isWildcardHost, ConfigError, type AgentConfig } from "./config.ts";
export { createCollector, defaultCollectorDeps, type Collector, type CollectorDeps } from "./metrics/collector.ts";
export { MetricHistoryBuffer } from "./metrics/history.ts";
export { Sampler, type MetricsSnapshot } from "./sampler.ts";
export { AGENT_VERSION } from "./version.ts";
// serve.ts is intentionally not re-exported: importing it must never start anything.
