package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Metrics struct {
	MachineID     string         `json:"machineId"`
	At            time.Time      `json:"at"`
	CPU           CPUMetrics     `json:"cpu"`
	Memory        MemMetrics     `json:"memory"`
	Disks         []DiskMetrics  `json:"disks"`
	ExternalDisks []ExternalDisk `json:"externalDisks"`
	// Errors is an addition to the contract: which collectors failed, so a
	// zero is not mistaken for a real reading.
	Errors []string `json:"errors,omitempty"`
}

type CPUMetrics struct {
	UsagePercent float64    `json:"usagePercent"`
	Cores        int        `json:"cores"`
	Load         [3]float64 `json:"load"`
}

type MemMetrics struct {
	TotalBytes     uint64 `json:"totalBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
	SwapTotalBytes uint64 `json:"swapTotalBytes"`
	SwapUsedBytes  uint64 `json:"swapUsedBytes"`
}

type DiskMetrics struct {
	Mountpoint string `json:"mountpoint"`
	TotalBytes uint64 `json:"totalBytes"`
	UsedBytes  uint64 `json:"usedBytes"`
}

type ExternalDisk struct {
	Name       string    `json:"name"`
	Mountpoint string    `json:"mountpoint"`
	Mounted    bool      `json:"mounted"`
	Responsive bool      `json:"responsive"`
	TotalBytes *uint64   `json:"totalBytes"`
	UsedBytes  *uint64   `json:"usedBytes"`
	Error      *string   `json:"error"`
	CheckedAt  time.Time `json:"checkedAt"`
}

func round1(f float64) float64 { return float64(int64(f*10+0.5)) / 10 }

// MetricsCollector takes one sample per request, as the contract asks (the
// hub keeps the history). Samples are serialised: on macOS the CPU reading
// alone takes about a second.
type MetricsCollector struct {
	cfg    *Config
	prober *diskProber
	mu     sync.Mutex
}

func newMetricsCollector(cfg *Config) *MetricsCollector {
	return &MetricsCollector{cfg: cfg, prober: &diskProber{inflight: map[string]time.Time{}}}
}

func (m *MetricsCollector) Sample(ctx context.Context) *Metrics {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := &Metrics{MachineID: m.cfg.MachineID, Disks: []DiskMetrics{}, ExternalDisks: []ExternalDisk{}}

	// External disks run in parallel with the host collectors so a hung
	// disk costs at most diskTimeout on top of the CPU sample.
	var wg sync.WaitGroup
	var extErr error
	wg.Add(1)
	go func() {
		defer wg.Done()
		out.ExternalDisks, extErr = m.prober.probeAll(m.cfg, m.cfg.DiskTimeout.D())
	}()

	cpu, mem, errs := collectHost(ctx)
	out.CPU, out.Memory = cpu, mem
	for _, e := range errs {
		out.Errors = append(out.Errors, e.Error())
	}
	for _, mp := range platformInternalMounts {
		total, used, err := diskUsage(mp)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				out.Errors = append(out.Errors, "disk "+mp+": "+err.Error())
			}
			continue
		}
		out.Disks = append(out.Disks, DiskMetrics{Mountpoint: mp, TotalBytes: total, UsedBytes: used})
	}
	wg.Wait()
	if extErr != nil {
		out.Errors = append(out.Errors, "external disks: "+extErr.Error())
	}
	out.At = time.Now()
	return out
}

// diskProber touches each disk from a goroutine and stops waiting after the
// timeout. A syscall on a wedged disk cannot be cancelled, so the stuck
// goroutine is left behind; inflight stops a second one piling up on the
// same path while the first is still blocked.
type diskProber struct {
	mu       sync.Mutex
	inflight map[string]time.Time
}

func (p *diskProber) probeAll(cfg *Config, timeout time.Duration) ([]ExternalDisk, error) {
	disks := append([]ExternalDiskConfig(nil), cfg.ExternalDisks...)
	var listErr error
	if cfg.VolumesRoot != "" {
		known := map[string]bool{}
		for _, d := range disks {
			known[d.Mountpoint] = true
		}
		names, err := p.listDir(cfg.VolumesRoot, timeout)
		listErr = err
		for _, name := range names {
			mp := filepath.Join(cfg.VolumesRoot, name)
			if !known[mp] {
				disks = append(disks, ExternalDiskConfig{Name: name, Mountpoint: mp})
			}
		}
	}
	out := make([]ExternalDisk, len(disks))
	var wg sync.WaitGroup
	for i, d := range disks {
		wg.Add(1)
		go func(i int, d ExternalDiskConfig) {
			defer wg.Done()
			out[i] = p.probe(d, timeout)
		}(i, d)
	}
	wg.Wait()
	return out, listErr
}

func (p *diskProber) listDir(root string, timeout time.Duration) ([]string, error) {
	if !p.begin(root) {
		return nil, errors.New(root + ": previous listing still blocked")
	}
	type res struct {
		names []string
		err   error
	}
	ch := make(chan res, 1)
	go func() {
		defer p.end(root)
		entries, err := os.ReadDir(root)
		var names []string
		for _, e := range entries {
			// Skip symlinks such as "Macintosh HD" -> "/" (not a separate
			// volume) and dot entries such as Time Machine's local snapshots.
			if e.Type()&fs.ModeSymlink != 0 || !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			names = append(names, e.Name())
		}
		sort.Strings(names)
		ch <- res{names, err}
	}()
	select {
	case r := <-ch:
		return r.names, r.err
	case <-time.After(timeout):
		return nil, errors.New(root + ": no answer within " + timeout.String())
	}
}

func (p *diskProber) begin(path string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if _, busy := p.inflight[path]; busy {
		return false
	}
	p.inflight[path] = time.Now()
	return true
}

func (p *diskProber) end(path string) {
	p.mu.Lock()
	delete(p.inflight, path)
	p.mu.Unlock()
}

var errNotMounted = errors.New("not mounted")

type probeResult struct {
	total, used uint64
	err         error
}

func (p *diskProber) probe(d ExternalDiskConfig, timeout time.Duration) ExternalDisk {
	out := ExternalDisk{Name: d.Name, Mountpoint: d.Mountpoint}
	fail := func(mounted bool, msg string) ExternalDisk {
		out.Mounted = mounted
		out.Error = &msg
		out.CheckedAt = time.Now()
		return out
	}
	if !p.begin(d.Mountpoint) {
		p.mu.Lock()
		since := p.inflight[d.Mountpoint]
		p.mu.Unlock()
		// Only a mounted filesystem can block; an absent directory fails fast.
		return fail(true, "previous probe still blocked since "+since.Format(time.RFC3339))
	}
	ch := make(chan probeResult, 1)
	go func() {
		defer p.end(d.Mountpoint)
		ch <- probeDisk(d.Mountpoint)
	}()
	select {
	case r := <-ch:
		switch {
		case errors.Is(r.err, errNotMounted) || errors.Is(r.err, fs.ErrNotExist):
			return fail(false, "not mounted")
		case r.err != nil:
			return fail(true, shortErr(r.err))
		}
		out.Mounted, out.Responsive = true, true
		out.TotalBytes, out.UsedBytes = &r.total, &r.used
		out.CheckedAt = time.Now()
		return out
	case <-time.After(timeout):
		return fail(true, "no answer within "+timeout.String())
	}
}

// probeDisk proves the disk answers: a mount point check, statfs for the
// sizes, then a one-entry directory read, because statfs can be served from
// cached metadata while reads would hang.
func probeDisk(mp string) probeResult {
	fi, err := os.Stat(mp)
	if err != nil {
		return probeResult{err: err}
	}
	parent, err := os.Stat(filepath.Dir(mp))
	if err != nil {
		return probeResult{err: err}
	}
	if a, b := devOf(fi), devOf(parent); a != nil && b != nil && *a == *b {
		return probeResult{err: errNotMounted}
	}
	total, used, err := diskUsage(mp)
	if err != nil {
		return probeResult{err: err}
	}
	f, err := os.Open(mp)
	if err != nil {
		return probeResult{err: err}
	}
	defer f.Close()
	if _, err := f.Readdirnames(1); err != nil && !errors.Is(err, io.EOF) {
		return probeResult{err: err}
	}
	return probeResult{total: total, used: used}
}

func devOf(fi os.FileInfo) *uint64 {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	d := uint64(st.Dev)
	return &d
}

// shortErr drops the path from *PathError: the contract wants errors
// without paths outside the mountpoint, and the mountpoint is already shown.
func shortErr(err error) string {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Op + ": " + pe.Err.Error()
	}
	return err.Error()
}
