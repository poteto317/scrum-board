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

	_ "github.com/go-sql-driver/mysql"
	"scrumboard/internal/kanban"
	"scrumboard/internal/mysqlconfig"
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
	cfg := mysqlconfig.ForServer(func(k string) string { return os.Getenv(k) })
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
	err = repo.RenameCardTablesToItems(migrationCtx)
	// L-791: rename columns before Initialize* so CREATE IF NOT EXISTS / app SQL see item_* names.
	if err == nil {
		err = repo.RenameCardColumnsToItems(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeItemPositions(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeItemOffsetY(migrationCtx)
	}
	if err == nil {
		// Projects exist before active_project_id is seeded inside board settings.
		err = repo.InitializeProjects(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeSprints(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeRecurringRules(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeBoardSettings(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeBacklogPositions(migrationCtx)
	}
	if err == nil {
		err = repo.InitializePRLinks(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeRelatedItems(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeNumbers(migrationCtx)
	}
	if err == nil {
		// Assignee column must exist before history baseline scans cardFields.
		err = repo.InitializeAssignee(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeCloseReason(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeDueAt(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeDeletedAt(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeSolution(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeFavorite(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeArchive(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeHistory(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeCommandTemplates(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeItemCommandTemplates(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeListFilter(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeHeaderMenu(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeComments(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeAIChat(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeUsers(migrationCtx)
	}
	if err == nil {
		// project_ai_messages references users: it cannot be part of InitializeAIChat, which runs before InitializeUsers.
		err = repo.InitializeProjectAIChat(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeSessions(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeItemACL(migrationCtx)
	}
	if err == nil {
		err = repo.InitializeItemAttachments(migrationCtx)
	}
	if err == nil {
		err = repo.SeedAdminFromEnv(migrationCtx, os.Getenv)
	}
	migrationCancel()
	if err != nil {
		return err
	}
	handler := buildHandler(repo, os.Getenv)
	// Read/Write timeouts allow ≤5 MiB multipart attachment uploads (see ATTACHMENT_GCS_BUCKET).
	server := &http.Server{Addr: env("LISTEN_ADDRESS", "127.0.0.1:8080"), Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second}
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
