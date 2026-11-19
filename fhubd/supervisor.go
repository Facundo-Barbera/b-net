package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	stStopped   = "stopped"
	stStarting  = "starting"
	stRunning   = "running"
	stUnhealthy = "unhealthy"
	stStopping  = "stopping"
	stBackoff   = "backoff"
	stFailed    = "failed"
)

type ExitInfo struct {
	Code   int       `json:"code"`
	Signal string    `json:"signal,omitempty"`
	At     time.Time `json:"at"`
}

type HealthStatus struct {
	OK                  bool       `json:"ok"`
	CheckedAt           *time.Time `json:"checkedAt"`
	Error               string     `json:"error,omitempty"`
	ConsecutiveFailures int        `json:"consecutiveFailures"`
}

type ServiceStatus struct {
	Name  string `json:"name"`
	State string `json:"state"`
	// Since is when State last changed.
	Since               time.Time     `json:"since"`
	Desired             string        `json:"desired"`
	PID                 int           `json:"pid,omitempty"`
	StartedAt           *time.Time    `json:"startedAt"`
	Restarts            int           `json:"restarts"`
	ConsecutiveFailures int           `json:"consecutiveFailures"`
	NextRetryAt         *time.Time    `json:"nextRetryAt"`
	LastExit            *ExitInfo     `json:"lastExit"`
	LastError           string        `json:"lastError,omitempty"`
	Health              *HealthStatus `json:"health"`
	// attempts counts spawn attempts, so an action can tell a fresh run
	// from the one that was already up when it was requested.
	attempts int
}

// contractState folds the supervisor's states into the hub contract's enum.
// unhealthy keeps "running" (the process is up; health says the rest) and
// backoff is "failed" because the service is down until the retry.
func contractState(state string) string {
	switch state {
	case stUnhealthy:
		return stRunning
	case stBackoff:
		return stFailed
	}
	return state
}

type Supervisor struct {
	services []*service
	byName   map[string]*service
	wg       sync.WaitGroup
}

func newSupervisor(cfg *Config) *Supervisor {
	sup := &Supervisor{byName: map[string]*service{}}
	now := time.Now()
	for _, sc := range cfg.Services {
		s := &service{
			cfg:         sc,
			globalEnv:   cfg.Env,
			wake:        make(chan struct{}, 1),
			changed:     make(chan struct{}),
			wantRunning: sc.autostart(),
		}
		s.st = ServiceStatus{Name: sc.Name, State: stStopped, Since: now}
		if sc.Healthcheck != nil {
			s.st.Health = &HealthStatus{}
		}
		sup.services = append(sup.services, s)
		sup.byName[sc.Name] = s
	}
	return sup
}

// Run starts one goroutine per service. Cancelling ctx stops every child;
// Wait returns once all of them are gone.
func (sup *Supervisor) Run(ctx context.Context) {
	for _, s := range sup.services {
		sup.wg.Add(1)
		go func(s *service) {
			defer sup.wg.Done()
			s.loop(ctx)
		}(s)
	}
}

func (sup *Supervisor) Wait() { sup.wg.Wait() }

func (sup *Supervisor) Get(name string) *service { return sup.byName[name] }

func (sup *Supervisor) Services() []*service { return sup.services }

type service struct {
	cfg       ServiceConfig
	globalEnv map[string]string
	wake      chan struct{}
	// actionMu serialises API actions; a second one while the first still
	// waits is a 409 in the contract.
	actionMu sync.Mutex

	mu          sync.Mutex
	wantRunning bool
	restartReq  bool
	st          ServiceStatus
	// changed is closed and replaced on every status change so waiters
	// can block without polling.
	changed chan struct{}
}

func (s *service) notify() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// mutate is the only way status and desired state change, so Since and
// the change broadcast cannot be forgotten.
func (s *service) mutate(f func()) {
	s.mu.Lock()
	old := s.st.State
	f()
	if s.st.State != old {
		s.st.Since = time.Now()
	}
	close(s.changed)
	s.changed = make(chan struct{})
	s.mu.Unlock()
}

func (s *service) update(f func(st *ServiceStatus)) { s.mutate(func() { f(&s.st) }) }

func (s *service) setState(state string) { s.update(func(st *ServiceStatus) { st.State = state }) }

func (s *service) clearFailedLocked() {
	if s.st.State == stFailed {
		s.st.State = stStopped
		s.st.ConsecutiveFailures = 0
	}
}

func (s *service) Start() {
	s.mutate(func() {
		s.wantRunning = true
		s.clearFailedLocked()
	})
	s.notify()
}

func (s *service) Stop() {
	s.mutate(func() {
		s.wantRunning = false
		s.restartReq = false
	})
	s.notify()
}

func (s *service) Restart() {
	s.mutate(func() {
		s.wantRunning = true
		s.restartReq = true
		s.clearFailedLocked()
	})
	s.notify()
}

func (s *service) Status() ServiceStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

func (s *service) statusLocked() ServiceStatus {
	st := s.st
	st.Desired = stStopped
	if s.wantRunning {
		st.Desired = stRunning
	}
	if s.st.Health != nil {
		h := *s.st.Health
		st.Health = &h
	}
	if s.st.LastExit != nil {
		e := *s.st.LastExit
		st.LastExit = &e
	}
	return st
}

// Do applies an action and waits, up to the service's actionTimeout, for
// the state it asks for: running (healthy, when there is a healthcheck)
// for start and restart, stopped for stop. A restart only counts once a new
// run has come up.
func (s *service) Do(action string) (ok bool, st ServiceStatus, msg string) {
	s.mu.Lock()
	before := s.st.attempts
	s.mu.Unlock()
	switch action {
	case "start":
		s.Start()
	case "stop":
		s.Stop()
	case "restart":
		s.Restart()
	default:
		return false, s.Status(), "unknown action"
	}
	timeout := s.cfg.ActionTimeout.D()
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	for {
		s.mu.Lock()
		st = s.statusLocked()
		changed := s.changed
		s.mu.Unlock()
		fresh := st.attempts > before
		switch action {
		case "stop":
			if st.State == stStopped || st.State == stFailed {
				return true, st, ""
			}
		case "start", "restart":
			up := st.State == stRunning || (action == "start" && st.State == stUnhealthy)
			if up && (action == "start" || fresh) {
				return true, st, ""
			}
			if fresh && (st.State == stBackoff || st.State == stFailed) {
				return false, st, failureMessage(st)
			}
		}
		select {
		case <-changed:
		case <-deadline.C:
			return false, st, fmt.Sprintf("timed out after %s; state is %s", timeout, st.State)
		}
	}
}

func failureMessage(st ServiceStatus) string {
	switch {
	case st.LastError != "":
		return st.LastError
	case st.LastExit != nil && st.LastExit.Signal != "":
		return "exited on " + st.LastExit.Signal
	case st.LastExit != nil:
		return fmt.Sprintf("exited with code %d", st.LastExit.Code)
	}
	return "failed to start"
}

func (s *service) flags() (want, restart bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.wantRunning, s.restartReq
}

type outcome int

const (
	outExitedOK outcome = iota
	outFailed           // non-zero exit, signal, spawn error
	outUnhealthy
	outStopRequested
	outRestartRequested
	outShutdown
)

func (s *service) loop(ctx context.Context) {
	rc := s.cfg.Restart
	failures := 0
	for {
		if ctx.Err() != nil {
			return
		}
		want, _ := s.flags()
		if !want {
			s.update(func(st *ServiceStatus) {
				if st.State != stFailed {
					st.State = stStopped
				}
				st.NextRetryAt = nil
			})
			select {
			case <-ctx.Done():
				return
			case <-s.wake:
				continue
			}
		}

		s.mutate(func() { s.restartReq = false })
		started := time.Now()
		out := s.runOnce(ctx)
		if time.Since(started) >= rc.ResetAfter.D() {
			failures = 0
			s.update(func(st *ServiceStatus) { st.ConsecutiveFailures = 0 })
		}

		switch out {
		case outShutdown:
			return
		case outStopRequested:
			continue
		case outRestartRequested:
			failures = 0
			s.update(func(st *ServiceStatus) { st.Restarts++; st.ConsecutiveFailures = 0 })
			continue
		}

		if rc.Policy == "never" || (rc.Policy == "on-failure" && out == outExitedOK) {
			s.mutate(func() {
				s.wantRunning = false
				if out != outExitedOK {
					s.st.State = stFailed
				}
			})
			continue
		}

		failures++
		s.update(func(st *ServiceStatus) { st.ConsecutiveFailures = failures })
		if rc.MaxRestarts > 0 && failures > rc.MaxRestarts {
			log.Printf("%s: giving up after %d consecutive failures", s.cfg.Name, failures-1)
			s.mutate(func() {
				s.wantRunning = false
				s.st.State = stFailed
			})
			continue
		}

		delay := backoffDelay(rc, failures)
		next := time.Now().Add(delay)
		s.update(func(st *ServiceStatus) { st.State = stBackoff; st.NextRetryAt = &next })
		log.Printf("%s: restarting in %s (failure %d)", s.cfg.Name, delay, failures)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-s.wake:
			// Stop, start or restart during backoff: the loop top applies it now.
			timer.Stop()
		case <-timer.C:
			s.update(func(st *ServiceStatus) { st.Restarts++ })
		}
		s.update(func(st *ServiceStatus) { st.NextRetryAt = nil })
	}
}

func backoffDelay(rc RestartConfig, failures int) time.Duration {
	d := rc.InitialBackoff.D()
	for i := 1; i < failures && d < rc.MaxBackoff.D(); i++ {
		d *= 2
	}
	if d > rc.MaxBackoff.D() {
		d = rc.MaxBackoff.D()
	}
	return d
}

func (s *service) runOnce(ctx context.Context) outcome {
	s.update(func(st *ServiceStatus) { st.State = stStarting; st.LastError = ""; st.attempts++ })
	cmd, err := s.spawn()
	if err != nil {
		log.Printf("%s: start failed: %v", s.cfg.Name, err)
		s.update(func(st *ServiceStatus) { st.LastError = err.Error() })
		return outFailed
	}
	pgid := cmd.Process.Pid // Setpgid with Pgid 0 makes the child its own group leader.
	started := time.Now()
	log.Printf("%s: started pid %d", s.cfg.Name, pgid)
	s.update(func(st *ServiceStatus) {
		st.PID = pgid
		st.StartedAt = &started
		if st.Health != nil {
			st.Health = &HealthStatus{}
		}
	})

	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	h := s.cfg.Healthcheck
	var tick <-chan time.Time
	if h == nil {
		s.setState(stRunning)
	} else {
		t := time.NewTicker(h.Interval.D())
		defer t.Stop()
		tick = t.C
	}
	hctx, hcancel := context.WithCancel(ctx)
	defer hcancel()
	healthRes := make(chan error, 1)
	inflight := false
	healthFails := 0
	stopTimeout := s.cfg.StopTimeout.D()

	finish := func(waitErr error, sendTerm bool) {
		s.recordExit(cmd.ProcessState, waitErr)
		reapGroup(pgid, stopTimeout, sendTerm)
	}
	stop := func(reason string) {
		s.setState(stStopping)
		log.Printf("%s: stopping pid %d (%s)", s.cfg.Name, pgid, reason)
		finish(terminate(pgid, exited, stopTimeout), false)
	}

	for {
		select {
		case err := <-exited:
			finish(err, true)
			if cmd.ProcessState != nil && cmd.ProcessState.Success() {
				log.Printf("%s: exited cleanly", s.cfg.Name)
				return outExitedOK
			}
			log.Printf("%s: exited: %v", s.cfg.Name, err)
			return outFailed

		case <-ctx.Done():
			stop("fhubd shutting down")
			return outShutdown

		case <-s.wake:
			want, restart := s.flags()
			if !want {
				stop("stop requested")
				return outStopRequested
			}
			if restart {
				stop("restart requested")
				return outRestartRequested
			}

		case <-tick:
			if !inflight {
				inflight = true
				go func() { healthRes <- runHealthcheck(hctx, h) }()
			}

		case err := <-healthRes:
			inflight = false
			now := time.Now()
			inStartPeriod := now.Sub(started) < h.StartPeriod.D()
			if err == nil {
				healthFails = 0
			} else if !inStartPeriod {
				healthFails++
			}
			s.update(func(st *ServiceStatus) {
				st.Health = &HealthStatus{OK: err == nil, CheckedAt: &now, ConsecutiveFailures: healthFails}
				switch {
				case err == nil:
					st.State = stRunning
				case !inStartPeriod:
					st.Health.Error = err.Error()
					st.State = stUnhealthy
				default:
					st.Health.Error = err.Error()
				}
			})
			if healthFails >= h.FailureThreshold {
				stop(fmt.Sprintf("healthcheck failed %d times: %v", healthFails, err))
				s.update(func(st *ServiceStatus) { st.LastError = "healthcheck: " + err.Error() })
				return outUnhealthy
			}
		}
	}
}

func (s *service) recordExit(ps *os.ProcessState, waitErr error) {
	info := &ExitInfo{Code: -1, At: time.Now()}
	if ps != nil {
		info.Code = ps.ExitCode()
		if ws, ok := ps.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
			info.Signal = ws.Signal().String()
		}
	}
	s.update(func(st *ServiceStatus) {
		st.PID = 0
		st.StartedAt = nil
		st.LastExit = info
		if ps == nil && waitErr != nil {
			st.LastError = waitErr.Error()
		}
	})
}

func (s *service) spawn() (*exec.Cmd, error) {
	env := mergeEnv(os.Environ(), s.globalEnv, s.cfg.Env)
	path, err := lookPathIn(s.cfg.Command, envLookup(env, "PATH"))
	if err != nil {
		return nil, err
	}
	logf, err := openServiceLog(s.cfg.Log, s.cfg.LogMaxBytes)
	if err != nil {
		return nil, fmt.Errorf("open log: %w", err)
	}
	// The child holds its own copy of the descriptor after Start.
	defer logf.Close()
	fmt.Fprintf(logf, "\n--- fhubd %s: starting %s %s\n", time.Now().Format(time.RFC3339), path, strings.Join(s.cfg.Args, " "))

	cmd := exec.Command(path, s.cfg.Args...)
	cmd.Dir = s.cfg.Cwd
	cmd.Env = env
	cmd.Stdout = logf
	cmd.Stderr = logf
	cmd.SysProcAttr = platformSysProcAttr()
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(logf, "--- fhubd: start failed: %v\n", err)
		return nil, err
	}
	return cmd, nil
}

// terminate sends SIGTERM to the whole group, waits up to timeout for the
// leader, then SIGKILLs the group.
func terminate(pgid int, exited <-chan error, timeout time.Duration) error {
	signalGroup(pgid, syscall.SIGTERM)
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case err := <-exited:
		return err
	case <-t.C:
		signalGroup(pgid, syscall.SIGKILL)
		return <-exited
	}
}

// reapGroup makes sure nothing in the child's process group outlives it, so
// a crashed leader cannot leave workers holding ports or files.
func reapGroup(pgid int, timeout time.Duration, sendTerm bool) {
	if !groupAlive(pgid) {
		return
	}
	if sendTerm {
		signalGroup(pgid, syscall.SIGTERM)
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !groupAlive(pgid) {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	signalGroup(pgid, syscall.SIGKILL)
}

func signalGroup(pgid int, sig syscall.Signal) {
	if pgid <= 1 {
		return // never signal our own or launchd's group by accident
	}
	if err := syscall.Kill(-pgid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		log.Printf("signal %v to group %d: %v", sig, pgid, err)
	}
}

func groupAlive(pgid int) bool {
	if pgid <= 1 {
		return false
	}
	return !errors.Is(syscall.Kill(-pgid, 0), syscall.ESRCH)
}

// mergeEnv layers maps over the inherited environment. Values may reference
// earlier values with $VAR (e.g. "PATH": "/opt/homebrew/bin:$PATH").
func mergeEnv(base []string, layers ...map[string]string) []string {
	m := make(map[string]string, len(base))
	order := make([]string, 0, len(base))
	for _, kv := range base {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		if _, dup := m[k]; !dup {
			order = append(order, k)
		}
		m[k] = v
	}
	for _, layer := range layers {
		// Expand against the environment before this layer so "$PATH" means the previous PATH.
		prev := make(map[string]string, len(m))
		for k, v := range m {
			prev[k] = v
		}
		for k, v := range layer {
			if _, exists := m[k]; !exists {
				order = append(order, k)
			}
			m[k] = os.Expand(v, func(name string) string { return prev[name] })
		}
	}
	out := make([]string, 0, len(order))
	for _, k := range order {
		out = append(out, k+"="+m[k])
	}
	return out
}

func envLookup(env []string, key string) string {
	for i := len(env) - 1; i >= 0; i-- {
		if k, v, ok := strings.Cut(env[i], "="); ok && k == key {
			return v
		}
	}
	return ""
}

// lookPathIn resolves a bare command against the service's PATH rather than
// fhubd's, which under launchd is only /usr/bin:/bin:/usr/sbin:/sbin.
func lookPathIn(cmd, pathEnv string) (string, error) {
	if strings.Contains(cmd, "/") {
		if err := checkExecutable(cmd); err != nil {
			return "", err
		}
		return cmd, nil
	}
	for _, dir := range filepath.SplitList(pathEnv) {
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		p := filepath.Join(dir, cmd)
		if checkExecutable(p) == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("%q not found in PATH %q", cmd, pathEnv)
}

func checkExecutable(p string) error {
	fi, err := os.Stat(p)
	if err != nil {
		return err
	}
	if fi.IsDir() || fi.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("%s is not an executable file", p)
	}
	return nil
}
