package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
	"scrumboard/internal/kanban"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	cfg := mysql.NewConfig()
	cfg.User = env("DB_USER", "scrum")
	cfg.Passwd = env("DB_PASSWORD", "scrum_dev")
	cfg.Net = "tcp"
	cfg.Addr = env("DB_ADDRESS", "127.0.0.1:3307")
	cfg.DBName = env("DB_NAME", "scrumboard")
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 10 * time.Second
	cfg.WriteTimeout = 10 * time.Second
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(3 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	err = db.PingContext(ctx)
	cancel()
	if err != nil {
		return err
	}
	repo := kanban.MySQLRepository{DB: db}
	migrationCtx, migrationCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	err = repo.InitializeCardPositions(migrationCtx)
	if err == nil {
		err = repo.InitializePRLinks(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeNumbers(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeHistory(migrationCtx)
	}
	migrationCancel()
	if err != nil {
		return err
	}
	handler := buildHandler(repo, os.Getenv)
	server := &http.Server{Addr: env("LISTEN_ADDRESS", "127.0.0.1:8080"), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 1)
	go func() { slog.Info("API listening", "address", server.Addr); errCh <- server.ListenAndServe() }()
	select {
	case err = <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
