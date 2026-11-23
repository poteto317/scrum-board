package mysqlconfig

import (
	"fmt"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// EnvWithDefault returns getenv(key) when non-empty, otherwise fallback.
func EnvWithDefault(getenv func(string) string, key, fallback string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return fallback
}

// FromDBEnv builds a MySQL driver config from DB_* environment variables (TCP or Unix socket).
func FromDBEnv(getenv func(string) string) *mysql.Config {
	cfg := mysql.NewConfig()
	cfg.User = EnvWithDefault(getenv, "DB_USER", "scrum")
	cfg.Passwd = EnvWithDefault(getenv, "DB_PASSWORD", "scrum_dev")
	cfg.DBName = EnvWithDefault(getenv, "DB_NAME", "scrumboard")
	if socket := strings.TrimSpace(getenv("DB_SOCKET")); socket != "" {
		cfg.Net = "unix"
		cfg.Addr = socket
	} else {
		cfg.Net = "tcp"
		cfg.Addr = EnvWithDefault(getenv, "DB_ADDRESS", "127.0.0.1:3307")
	}
	ApplyStandardDriverFlags(cfg)
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	return cfg
}

// ApplyStandardDriverFlags sets ParseTime, UTC location, and InterpolateParams.
// Prefer FromDBEnv / ForServer / ForCLI for app connections; call this after
// ParseDSN in tests or other DSN entry points that must match those defaults.
func ApplyStandardDriverFlags(cfg *mysql.Config) {
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.InterpolateParams = true
}

// ApplyTimeouts sets dial, read, and write timeouts on an existing config.
func ApplyTimeouts(cfg *mysql.Config, dial, read, write time.Duration) {
	cfg.Timeout = dial
	cfg.ReadTimeout = read
	cfg.WriteTimeout = write
}

// ForServer returns DB config with timeouts suited to the long-running API process.
func ForServer(getenv func(string) string) *mysql.Config {
	cfg := FromDBEnv(getenv)
	ApplyTimeouts(cfg, 5*time.Second, 10*time.Second, 10*time.Second)
	return cfg
}

// ForCLI prefers KANBAN_IMPORT_DSN when set; otherwise uses DB_* env vars with CLI-oriented timeouts.
func ForCLI(getenv func(string) string) (*mysql.Config, error) {
	if dsn := strings.TrimSpace(getenv("KANBAN_IMPORT_DSN")); dsn != "" {
		cfg, err := mysql.ParseDSN(dsn)
		if err != nil {
			return nil, fmt.Errorf("invalid KANBAN_IMPORT_DSN")
		}
		ApplyStandardDriverFlags(cfg)
		cfg.MultiStatements = false
		ApplyTimeouts(cfg, 5*time.Second, 30*time.Second, 30*time.Second)
		return cfg, nil
	}
	cfg := FromDBEnv(getenv)
	ApplyTimeouts(cfg, 5*time.Second, 30*time.Second, 30*time.Second)
	return cfg, nil
}
