// Command fhubd is a small process supervisor for a single machine.
//
// It exists for macOS TCC: launchd starts fhubd (a signed binary at a fixed
// path) as a LaunchAgent and fhubd spawns every service as a direct child, so
// fhubd is the "responsible process" and its children inherit the Full Disk
// Access granted once to fhubd. Services whose binaries change on every update
// (T3, uv's python) then stop triggering new TCC prompts.
//
// The HTTP API implements the hub ↔ fhubd v0 contract in
// packages/core/src/contracts/fhubd.ts; that file is the source of truth for
// routes, bodies and status codes. Additions here, which the contract lets
// readers ignore: services carry detailState, desired, pid, restarts, health
// and lastExit; metrics carry errors. Every service reports manager "fhubd".
package main
