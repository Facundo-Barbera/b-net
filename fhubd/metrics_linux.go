//go:build linux

package main

import (
	"context"
	"errors"
	"runtime"
	"syscall"
)

var platformInternalMounts = []string{"/"}

// TODO(linux): CPU from /proc/stat deltas, load from /proc/loadavg, memory
// and swap from /proc/meminfo (MemAvailable for availableBytes).
func collectHost(context.Context) (CPUMetrics, MemMetrics, []error) {
	return CPUMetrics{Cores: runtime.NumCPU()}, MemMetrics{},
		[]error{errors.New("cpu and memory metrics are not implemented on linux yet")}
}

func diskUsage(path string) (total, used uint64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bs := uint64(st.Bsize)
	return st.Blocks * bs, (st.Blocks - st.Bfree) * bs, nil
}
