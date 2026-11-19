//go:build linux

package main

import "syscall"

const (
	platformDefaultLogDir      = "~/.local/state/fhub/logs"
	platformDefaultVolumesRoot = ""
)

// Pdeathsig is deliberately not set: in Go it fires when the forking OS
// thread exits, not the process, and would kill healthy children. A full
// Linux version should put each service in its own cgroup instead, which also
// catches descendants that leave the process group.
func platformSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
