package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Duration accepts Go duration strings ("5s", "2m") in JSON.
type Duration time.Duration

func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("duration must be a string like \"5s\": %w", err)
	}
	v, err := time.ParseDuration(s)
	if err != nil {
		return err
	}
	if v < 0 {
		return fmt.Errorf("duration %q is negative", s)
	}
	*d = Duration(v)
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) { return json.Marshal(time.Duration(d).String()) }
func (d Duration) D() time.Duration             { return time.Duration(d) }

type Config struct {
	// Comment is ignored; JSON has no comments and unknown keys are rejected.
	Comment string `json:"_comment"`
	// MachineID is reported in every response; defaults to the short hostname.
	MachineID string            `json:"machineId"`
	Listen    ListenConfig      `json:"listen"`
	TokenFile string            `json:"tokenFile"`
	LogDir    string            `json:"logDir"`
	Env       map[string]string `json:"env"`
	// ExternalDisks are always reported, so an unplugged disk shows up as
	// mounted:false instead of vanishing.
	ExternalDisks []ExternalDiskConfig `json:"externalDisks"`
	// VolumesRoot adds every other directory mounted under it (default
	// /Volumes on macOS); "none" disables discovery.
	VolumesRoot string          `json:"volumesRoot"`
	DiskTimeout Duration        `json:"diskTimeout"`
	Services    []ServiceConfig `json:"services"`
}

type ExternalDiskConfig struct {
	Name       string `json:"name"`
	Mountpoint string `json:"mountpoint"`
}

type ListenConfig struct {
	// Host is "localhost", "tailscale" (first 100.64.0.0/10 address found on
	// an interface) or a literal loopback/Tailscale IP. Never a wildcard.
	Host string `json:"host"`
	Port int    `json:"port"`
}

type ServiceConfig struct {
	Comment     string            `json:"_comment"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	// Actions the API may run; defaults to start, stop and restart.
	Actions []string `json:"actions"`
	// ActionTimeout bounds how long a POST waits for the state to land.
	ActionTimeout Duration          `json:"actionTimeout"`
	Command       string            `json:"command"`
	Args          []string          `json:"args"`
	Cwd           string            `json:"cwd"`
	Env           map[string]string `json:"env"`
	Autostart     *bool             `json:"autostart"`
	Healthcheck   *HealthConfig     `json:"healthcheck"`
	Restart       RestartConfig     `json:"restart"`
	StopTimeout   Duration          `json:"stopTimeout"`
	Log           string            `json:"log"`
	// LogMaxBytes rotates the log to <log>.1 when a start finds it larger.
	LogMaxBytes int64 `json:"logMaxBytes"`
}

type HealthConfig struct {
	HTTP             string   `json:"http"`
	TCP              string   `json:"tcp"`
	Interval         Duration `json:"interval"`
	Timeout          Duration `json:"timeout"`
	StartPeriod      Duration `json:"startPeriod"`
	FailureThreshold int      `json:"failureThreshold"`
}

type RestartConfig struct {
	Policy         string   `json:"policy"` // always | on-failure | never
	InitialBackoff Duration `json:"initialBackoff"`
	MaxBackoff     Duration `json:"maxBackoff"`
	// ResetAfter: a run at least this long resets the backoff counter.
	ResetAfter Duration `json:"resetAfter"`
	// MaxRestarts consecutive failed restarts before giving up; 0 = unlimited.
	MaxRestarts int `json:"maxRestarts"`
}

var serviceNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)

func defaultConfigPath() string { return expandHome("~/.config/fhub/fhubd.json") }

func loadConfig(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var c Config
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if err := c.normalize(); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &c, nil
}

func (c *Config) normalize() error {
	if c.Listen.Host == "" {
		c.Listen.Host = "localhost"
	}
	if c.Listen.Port == 0 {
		c.Listen.Port = 8790
	}
	if c.Listen.Port < 1 || c.Listen.Port > 65535 {
		return fmt.Errorf("listen.port %d out of range", c.Listen.Port)
	}
	if err := validateListenHost(c.Listen.Host); err != nil {
		return err
	}
	if c.TokenFile == "" {
		c.TokenFile = "~/.config/fhub/token"
	}
	c.TokenFile = expandHome(c.TokenFile)
	if c.LogDir == "" {
		c.LogDir = platformDefaultLogDir
	}
	c.LogDir = expandHome(c.LogDir)
	if c.VolumesRoot == "" {
		c.VolumesRoot = platformDefaultVolumesRoot
	}
	if c.VolumesRoot == "none" {
		c.VolumesRoot = ""
	}
	if c.DiskTimeout == 0 {
		c.DiskTimeout = Duration(2 * time.Second)
	}
	if c.MachineID == "" {
		h, err := os.Hostname()
		if err != nil {
			return fmt.Errorf("machineId not set and hostname unavailable: %w", err)
		}
		c.MachineID = strings.ToLower(strings.SplitN(h, ".", 2)[0])
	}
	diskNames := map[string]bool{}
	for i := range c.ExternalDisks {
		d := &c.ExternalDisks[i]
		if d.Name == "" || d.Mountpoint == "" || !filepath.IsAbs(d.Mountpoint) {
			return fmt.Errorf("externalDisks[%d]: name and an absolute mountpoint are required", i)
		}
		if diskNames[d.Name] {
			return fmt.Errorf("externalDisks: duplicate name %q", d.Name)
		}
		diskNames[d.Name] = true
		d.Mountpoint = filepath.Clean(d.Mountpoint)
	}

	seen := map[string]bool{}
	for i := range c.Services {
		s := &c.Services[i]
		if !serviceNameRe.MatchString(s.Name) {
			return fmt.Errorf("services[%d]: name %q must match %s", i, s.Name, serviceNameRe)
		}
		if seen[s.Name] {
			return fmt.Errorf("services: duplicate name %q", s.Name)
		}
		seen[s.Name] = true
		if s.Command == "" {
			return fmt.Errorf("service %s: command is required", s.Name)
		}
		s.Command = expandHome(s.Command)
		if s.Cwd != "" {
			s.Cwd = expandHome(s.Cwd)
		}
		if s.Log == "" {
			s.Log = filepath.Join(c.LogDir, s.Name+".log")
		}
		s.Log = expandHome(s.Log)
		if s.LogMaxBytes == 0 {
			s.LogMaxBytes = 50 << 20
		}
		if s.StopTimeout == 0 {
			s.StopTimeout = Duration(10 * time.Second)
		}
		if err := s.Restart.normalize(); err != nil {
			return fmt.Errorf("service %s: %w", s.Name, err)
		}
		if h := s.Healthcheck; h != nil {
			if (h.HTTP == "") == (h.TCP == "") {
				return fmt.Errorf("service %s: healthcheck needs exactly one of http or tcp", s.Name)
			}
			if h.HTTP != "" && !strings.HasPrefix(h.HTTP, "http://") && !strings.HasPrefix(h.HTTP, "https://") {
				return fmt.Errorf("service %s: healthcheck.http must be an http(s) URL", s.Name)
			}
			if h.TCP != "" {
				if _, _, err := net.SplitHostPort(h.TCP); err != nil {
					return fmt.Errorf("service %s: healthcheck.tcp: %w", s.Name, err)
				}
			}
			if h.Interval == 0 {
				h.Interval = Duration(10 * time.Second)
			}
			if h.Timeout == 0 {
				h.Timeout = Duration(3 * time.Second)
			}
			if h.StartPeriod == 0 {
				h.StartPeriod = Duration(30 * time.Second)
			}
			if h.FailureThreshold == 0 {
				h.FailureThreshold = 3
			}
		}
		if s.Actions == nil {
			s.Actions = []string{"start", "stop", "restart"}
		}
		for _, a := range s.Actions {
			if a != "start" && a != "stop" && a != "restart" {
				return fmt.Errorf("service %s: unknown action %q", s.Name, a)
			}
		}
		if s.ActionTimeout == 0 {
			// Long enough for a restart: stop (up to 2*stopTimeout) plus
			// reaching the first healthy check.
			up := 10 * time.Second
			if h := s.Healthcheck; h != nil {
				up = h.StartPeriod.D() + h.Interval.D() + h.Timeout.D()
			}
			s.ActionTimeout = Duration(2*s.StopTimeout.D() + up)
		}
		if s.ActionTimeout.D() > maxActionTimeout {
			return fmt.Errorf("service %s: actionTimeout above %s", s.Name, maxActionTimeout)
		}
	}
	return nil
}

// maxActionTimeout stays under the HTTP server's WriteTimeout so a waiting
// POST always gets its answer written.
const maxActionTimeout = 3 * time.Minute

func (s *ServiceConfig) allows(action string) bool {
	for _, a := range s.Actions {
		if a == action {
			return true
		}
	}
	return false
}

func (r *RestartConfig) normalize() error {
	switch r.Policy {
	case "":
		r.Policy = "always"
	case "always", "on-failure", "never":
	default:
		return fmt.Errorf("restart.policy %q must be always, on-failure or never", r.Policy)
	}
	if r.InitialBackoff == 0 {
		r.InitialBackoff = Duration(time.Second)
	}
	if r.MaxBackoff == 0 {
		r.MaxBackoff = Duration(time.Minute)
	}
	if r.MaxBackoff < r.InitialBackoff {
		return errors.New("restart.maxBackoff is smaller than restart.initialBackoff")
	}
	if r.ResetAfter == 0 {
		r.ResetAfter = Duration(2 * time.Minute)
	}
	if r.MaxRestarts < 0 {
		return errors.New("restart.maxRestarts must be >= 0")
	}
	return nil
}

func (s *ServiceConfig) autostart() bool { return s.Autostart == nil || *s.Autostart }

// validateListenHost enforces "Tailscale or loopback only": an unspecified
// address would expose the token-protected API to every network the Mac joins.
func validateListenHost(h string) error {
	switch h {
	case "localhost", "tailscale":
		return nil
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return fmt.Errorf("listen.host %q must be localhost, tailscale or an IP", h)
	}
	if ip.IsUnspecified() {
		return fmt.Errorf("listen.host %q: wildcard addresses are not allowed", h)
	}
	if !ip.IsLoopback() && !isTailscaleIP(ip) {
		return fmt.Errorf("listen.host %q is neither loopback nor a Tailscale (100.64.0.0/10) address", h)
	}
	return nil
}

var tailscaleNet = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

func isTailscaleIP(ip net.IP) bool {
	v4 := ip.To4()
	return v4 != nil && tailscaleNet.Contains(v4)
}

func expandHome(p string) string {
	if p != "~" && !strings.HasPrefix(p, "~/") {
		return p
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return p
	}
	return filepath.Join(home, strings.TrimPrefix(p, "~"))
}
