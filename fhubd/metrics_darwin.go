//go:build darwin

package main

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// On APFS "/" is the sealed system volume; user data, and so the number that
// fills up, lives on the Data volume.
var platformInternalMounts = []string{"/", "/System/Volumes/Data"}

// CPU and memory come from the stock tools instead of host_statistics(3) so
// the build stays CGO-free. top needs two samples one second apart to report
// a real CPU percentage; the rest takes milliseconds.
func collectHost(ctx context.Context) (CPUMetrics, MemMetrics, []error) {
	var errs []error
	cpu := CPUMetrics{Cores: runtime.NumCPU()}
	if out, err := runTool(ctx, "/usr/sbin/sysctl", "-n", "vm.loadavg"); err == nil {
		// "{ 1.23 1.10 1.05 }"
		f := strings.Fields(strings.Trim(strings.TrimSpace(out), "{}"))
		if len(f) >= 3 {
			for i := 0; i < 3; i++ {
				cpu.Load[i], _ = strconv.ParseFloat(f[i], 64)
			}
		}
	} else {
		errs = append(errs, err)
	}
	if out, err := runTool(ctx, "/usr/bin/top", "-l", "2", "-n", "0", "-s", "1"); err == nil {
		if idle, ok := parseTopIdle(out); ok {
			cpu.UsagePercent = round1(100 - idle)
		} else {
			errs = append(errs, fmt.Errorf("top: no CPU usage line"))
		}
	} else {
		errs = append(errs, err)
	}

	mem, err := darwinMemory(ctx)
	if err != nil {
		errs = append(errs, err)
	}
	if total, used, err := darwinSwap(ctx); err == nil {
		mem.SwapTotalBytes, mem.SwapUsedBytes = total, used
	} else {
		errs = append(errs, err)
	}
	return cpu, mem, errs
}

var topIdleRe = regexp.MustCompile(`CPU usage:.*?([0-9.]+)% idle`)

// parseTopIdle uses the last sample: top's first one averages since boot.
func parseTopIdle(out string) (float64, bool) {
	m := topIdleRe.FindAllStringSubmatch(out, -1)
	if len(m) == 0 {
		return 0, false
	}
	v, err := strconv.ParseFloat(m[len(m)-1][1], 64)
	return v, err == nil
}

// darwinMemory approximates Activity Monitor: used = app memory (anonymous
// minus purgeable) + wired + compressed; available = the rest, since file
// cache and purgeable pages are handed out without swapping.
func darwinMemory(ctx context.Context) (MemMetrics, error) {
	var m MemMetrics
	out, err := runTool(ctx, "/usr/sbin/sysctl", "-n", "hw.memsize")
	if err != nil {
		return m, err
	}
	total, err := strconv.ParseUint(strings.TrimSpace(out), 10, 64)
	if err != nil {
		return m, fmt.Errorf("hw.memsize: %w", err)
	}
	vm, err := runTool(ctx, "/usr/bin/vm_stat")
	if err != nil {
		return m, err
	}
	pageSize, pages := parseVMStat(vm)
	if pageSize == 0 {
		return m, fmt.Errorf("vm_stat: no page size")
	}
	var usedPages uint64
	if anon, ok := pages["Anonymous pages"]; ok {
		usedPages = anon
		if p := pages["Pages purgeable"]; p < usedPages {
			usedPages -= p
		}
	} else {
		usedPages = pages["Pages active"]
	}
	usedPages += pages["Pages wired down"] + pages["Pages occupied by compressor"]
	m.TotalBytes = total
	m.UsedBytes = usedPages * pageSize
	if m.UsedBytes > total {
		m.UsedBytes = total
	}
	m.AvailableBytes = total - m.UsedBytes
	return m, nil
}

var pageSizeRe = regexp.MustCompile(`page size of (\d+) bytes`)

func parseVMStat(out string) (uint64, map[string]uint64) {
	var pageSize uint64
	if m := pageSizeRe.FindStringSubmatch(out); m != nil {
		pageSize, _ = strconv.ParseUint(m[1], 10, 64)
	}
	pages := map[string]uint64{}
	sc := bufio.NewScanner(strings.NewReader(out))
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		n, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(v), "."), 10, 64)
		if err == nil {
			pages[strings.TrimSpace(k)] = n
		}
	}
	return pageSize, pages
}

var swapRe = regexp.MustCompile(`total = ([0-9.]+)([KMG])\s+used = ([0-9.]+)([KMG])`)

// darwinSwap parses "total = 2048.00M  used = 1024.50M  free = ...".
func darwinSwap(ctx context.Context) (uint64, uint64, error) {
	out, err := runTool(ctx, "/usr/sbin/sysctl", "-n", "vm.swapusage")
	if err != nil {
		return 0, 0, err
	}
	m := swapRe.FindStringSubmatch(out)
	if m == nil {
		return 0, 0, fmt.Errorf("vm.swapusage: unexpected %q", strings.TrimSpace(out))
	}
	return sizeWithUnit(m[1], m[2]), sizeWithUnit(m[3], m[4]), nil
}

func sizeWithUnit(num, unit string) uint64 {
	v, _ := strconv.ParseFloat(num, 64)
	mult := map[string]float64{"K": 1 << 10, "M": 1 << 20, "G": 1 << 30}[unit]
	return uint64(v * mult)
}

func runTool(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var out bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %w", name, err)
	}
	return out.String(), nil
}

func diskUsage(path string) (total, used uint64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bs := uint64(st.Bsize)
	return st.Blocks * bs, (st.Blocks - st.Bfree) * bs, nil
}
