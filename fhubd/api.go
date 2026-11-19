package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Limits from the contract (packages/core/src/contracts/fhubd.ts).
const (
	logsTailDefault = 200
	logsTailMax     = 2000
)

type API struct {
	machineID string
	tokenSum  []byte
	sup       *Supervisor
	metrics   *MetricsCollector
	startedAt time.Time
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v0/health", a.health)
	mux.HandleFunc("GET /v0/metrics", a.getMetrics)
	mux.HandleFunc("GET /v0/services", a.listServices)
	mux.HandleFunc("POST /v0/services/{name}/{action}", a.action)
	mux.HandleFunc("GET /v0/services/{name}/logs", a.logs)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusNotFound, "not found")
	})
	return a.auth(mux)
}

func (a *API) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !checkBearer(r.Header.Get("Authorization"), a.tokenSum) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="fhubd"`)
			writeErr(w, http.StatusUnauthorized, "missing or invalid bearer token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type healthBody struct {
	MachineID string    `json:"machineId"`
	Version   string    `json:"version"`
	API       string    `json:"api"`
	StartedAt time.Time `json:"startedAt"`
	OS        string    `json:"os"`
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, healthBody{
		MachineID: a.machineID,
		Version:   version,
		API:       "v0",
		StartedAt: a.startedAt,
		OS:        runtime.GOOS,
	})
}

func (a *API) getMetrics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.metrics.Sample(r.Context()))
}

// serviceBody is FhubdService plus fields the contract allows readers to
// ignore; detailState keeps the distinctions the contract's enum folds away.
type serviceBody struct {
	Name        string    `json:"name"`
	Description *string   `json:"description"`
	Manager     string    `json:"manager"`
	State       string    `json:"state"`
	Since       time.Time `json:"since"`
	Actions     []string  `json:"actions"`
	Logs        bool      `json:"logs"`

	DetailState         string        `json:"detailState"`
	Desired             string        `json:"desired"`
	PID                 int           `json:"pid,omitempty"`
	StartedAt           *time.Time    `json:"startedAt"`
	Restarts            int           `json:"restarts"`
	ConsecutiveFailures int           `json:"consecutiveFailures"`
	NextRetryAt         *time.Time    `json:"nextRetryAt"`
	LastExit            *ExitInfo     `json:"lastExit"`
	LastError           *string       `json:"lastError"`
	Health              *HealthStatus `json:"health"`
}

func toServiceBody(s *service, st ServiceStatus) serviceBody {
	b := serviceBody{
		Name: st.Name,
		// fhubd runs services as its own children, which the contract's
		// manager enum (systemd, systemd-user, launchd, docker) has no value for.
		Manager:             "fhubd",
		State:               contractState(st.State),
		Since:               st.Since,
		Actions:             s.cfg.Actions,
		Logs:                true,
		DetailState:         st.State,
		Desired:             st.Desired,
		PID:                 st.PID,
		StartedAt:           st.StartedAt,
		Restarts:            st.Restarts,
		ConsecutiveFailures: st.ConsecutiveFailures,
		NextRetryAt:         st.NextRetryAt,
		LastExit:            st.LastExit,
		Health:              st.Health,
	}
	if s.cfg.Description != "" {
		d := s.cfg.Description
		b.Description = &d
	}
	if st.LastError != "" {
		e := st.LastError
		b.LastError = &e
	}
	return b
}

func (a *API) listServices(w http.ResponseWriter, r *http.Request) {
	list := make([]serviceBody, 0, len(a.sup.Services()))
	for _, s := range a.sup.Services() {
		list = append(list, toServiceBody(s, s.Status()))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"machineId": a.machineID,
		"at":        time.Now(),
		"services":  list,
	})
}

type actionResult struct {
	Name    string    `json:"name"`
	Action  string    `json:"action"`
	OK      bool      `json:"ok"`
	State   string    `json:"state"`
	Message *string   `json:"message"`
	At      time.Time `json:"at"`
}

func (a *API) action(w http.ResponseWriter, r *http.Request) {
	s := a.sup.Get(r.PathValue("name"))
	if s == nil {
		writeErr(w, http.StatusNotFound, "unknown service")
		return
	}
	action := r.PathValue("action")
	if action != "start" && action != "stop" && action != "restart" {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if !s.cfg.allows(action) {
		writeErr(w, http.StatusForbidden, "action not allowed for this service")
		return
	}
	if !s.actionMu.TryLock() {
		writeErr(w, http.StatusConflict, "another action on this service is still running")
		return
	}
	defer s.actionMu.Unlock()

	ok, st, msg := s.Do(action)
	res := actionResult{Name: s.cfg.Name, Action: action, OK: ok, State: contractState(st.State), At: time.Now()}
	if msg != "" {
		res.Message = &msg
	}
	// The contract reports a failed action in the body (ok:false), not as
	// an HTTP error: the request itself was carried out.
	writeJSON(w, http.StatusOK, res)
}

type logLine struct {
	At   *time.Time `json:"at"`
	Text string     `json:"text"`
}

func (a *API) logs(w http.ResponseWriter, r *http.Request) {
	s := a.sup.Get(r.PathValue("name"))
	if s == nil {
		writeErr(w, http.StatusNotFound, "unknown service")
		return
	}
	n := logsTailDefault
	if q := r.URL.Query().Get("tail"); q != "" {
		v, err := strconv.Atoi(q)
		if err != nil || v < 1 || v > logsTailMax {
			writeErr(w, http.StatusBadRequest, "tail must be an integer between 1 and "+strconv.Itoa(logsTailMax))
			return
		}
		n = v
	}
	data, truncated, err := tailFile(s.cfg.Log, n)
	if errors.Is(err, fs.ErrNotExist) {
		data, truncated, err = nil, false, nil
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "cannot read log")
		return
	}
	lines := []logLine{}
	if len(data) > 0 {
		// Child output carries no timestamps fhubd can trust, so at is null.
		for _, l := range strings.Split(string(bytes.TrimSuffix(data, []byte{'\n'})), "\n") {
			lines = append(lines, logLine{Text: strings.TrimSuffix(l, "\r")})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": s.cfg.Name, "lines": lines, "truncated": truncated})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
