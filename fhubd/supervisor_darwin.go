//go:build darwin

package main

import "syscall"

const (
	platformDefaultLogDir      = "~/Library/Logs/fhub"
	platformDefaultVolumesRoot = "/Volumes"
)

// Children must keep fhubd as their TCC responsible process, so nothing here
// may disclaim responsibility (responsibility_spawnattrs_setdisclaim); Go's
// fork/exec never does. Setpgid gives each service its own process group so
// stop and shutdown can signal the whole tree without touching fhubd.
func platformSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
