package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

// readToken refuses a token file readable by group or others: the token
// grants start/stop over every service, so a loose mode is treated as leaked.
func readToken(path string) ([]byte, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if fi.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s has mode %v; run: chmod 600 %s", path, fi.Mode().Perm(), path)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	tok := strings.TrimSpace(string(raw))
	if len(tok) < 32 {
		return nil, fmt.Errorf("%s: token shorter than 32 characters", path)
	}
	sum := sha256.Sum256([]byte(tok))
	return sum[:], nil
}

// checkBearer compares hashes so the comparison is constant-time regardless
// of the presented token's length.
func checkBearer(header string, wantSum []byte) bool {
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return false
	}
	got := sha256.Sum256([]byte(strings.TrimSpace(header[len(prefix):])))
	return subtle.ConstantTimeCompare(got[:], wantSum) == 1
}

func resolveListenIP(host string) (net.IP, error) {
	switch host {
	case "localhost":
		return net.IPv4(127, 0, 0, 1), nil
	case "tailscale":
		return findTailscaleIP()
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return nil, fmt.Errorf("bad listen host %q", host)
	}
	return ip, nil
}

func findTailscaleIP() (net.IP, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && isTailscaleIP(ipn.IP) {
				return ipn.IP.To4(), nil
			}
		}
	}
	return nil, errors.New("no Tailscale (100.64.0.0/10) address on any interface")
}

// listenWhenReady retries because at login Tailscale often has not brought
// its interface up yet; services keep running while the API waits.
func listenWhenReady(ctx context.Context, cfg ListenConfig) (net.Listener, error) {
	var lastErr string
	for {
		ip, err := resolveListenIP(cfg.Host)
		if err == nil {
			if ip.IsUnspecified() {
				return nil, errors.New("refusing to listen on a wildcard address")
			}
			addr := net.JoinHostPort(ip.String(), strconv.Itoa(cfg.Port))
			var ln net.Listener
			ln, err = net.Listen("tcp", addr)
			if err == nil {
				return ln, nil
			}
		}
		if err.Error() != lastErr {
			log.Printf("api: cannot listen yet (%v); retrying every 5s", err)
			lastErr = err.Error()
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
}
