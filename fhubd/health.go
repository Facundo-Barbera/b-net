package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
)

var healthClient = &http.Client{
	// A redirect (e.g. to a login page) still proves the server answers.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

func runHealthcheck(ctx context.Context, h *HealthConfig) error {
	ctx, cancel := context.WithTimeout(ctx, h.Timeout.D())
	defer cancel()
	if h.TCP != "" {
		var d net.Dialer
		c, err := d.DialContext(ctx, "tcp", h.TCP)
		if err != nil {
			return err
		}
		return c.Close()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.HTTP, nil)
	if err != nil {
		return err
	}
	resp, err := healthClient.Do(req)
	if err != nil {
		return err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("http status %d", resp.StatusCode)
	}
	return nil
}
