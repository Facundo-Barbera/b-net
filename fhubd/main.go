package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	configPath := flag.String("config", defaultConfigPath(), "path to fhubd.json")
	check := flag.Bool("check", false, "validate the config and token file, then exit")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Parse()
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("fhubd: ")

	if *showVersion {
		fmt.Println(version)
		return
	}
	if err := run(*configPath, *check); err != nil {
		log.Printf("fatal: %v", err)
		os.Exit(1)
	}
}

func run(configPath string, checkOnly bool) error {
	cfg, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	tokenSum, err := readToken(cfg.TokenFile)
	if err != nil {
		return fmt.Errorf("token: %w", err)
	}
	if checkOnly {
		fmt.Printf("ok: %d services, api on %s:%d\n", len(cfg.Services), cfg.Listen.Host, cfg.Listen.Port)
		return nil
	}

	// SIGHUP would otherwise kill fhubd without stopping its children.
	signal.Ignore(syscall.SIGHUP)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	log.Printf("version %s, pid %d, machine %s, config %s, %d services", version, os.Getpid(), cfg.MachineID, configPath, len(cfg.Services))

	sup := newSupervisor(cfg)
	sup.Run(ctx)

	api := &API{
		machineID: cfg.MachineID,
		tokenSum:  tokenSum,
		sup:       sup,
		metrics:   newMetricsCollector(cfg),
		startedAt: time.Now(),
	}
	srv := &http.Server{
		Handler:           api.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Action POSTs wait for the service to settle (see maxActionTimeout).
		WriteTimeout: maxActionTimeout + 30*time.Second,
		IdleTimeout:       60 * time.Second,
	}
	apiDone := make(chan struct{})
	go func() {
		defer close(apiDone)
		ln, err := listenWhenReady(ctx, cfg.Listen)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				log.Printf("api: %v", err)
			}
			return
		}
		log.Printf("api: listening on %s", ln.Addr())
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("api: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down: stopping services")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = srv.Shutdown(shutCtx)
	shutCancel()
	<-apiDone
	// Each service bounds its stop to 2*stopTimeout (leader, then leftover
	// group members), so launchd's ExitTimeOut in the plist must stay above
	// twice the largest stopTimeout or launchd SIGKILLs fhubd mid-cleanup.
	sup.Wait()
	log.Printf("all services stopped")
	return nil
}
