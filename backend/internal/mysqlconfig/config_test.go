package mysqlconfig

import (
	"strings"
	"testing"
)

func TestFromDBEnv_TCPDefaults(t *testing.T) {
	cfg := FromDBEnv(func(string) string { return "" })
	if cfg.Net != "tcp" {
		t.Fatalf("Net = %q, want tcp", cfg.Net)
	}
	if cfg.Addr != "127.0.0.1:3307" {
		t.Fatalf("Addr = %q, want 127.0.0.1:3307", cfg.Addr)
	}
	if cfg.User != "scrum" || cfg.Passwd != "scrum_dev" || cfg.DBName != "scrumboard" {
		t.Fatalf("unexpected credentials/db: user=%q passwd=%q db=%q", cfg.User, cfg.Passwd, cfg.DBName)
	}
	dsn := cfg.FormatDSN()
	if !strings.Contains(dsn, "tcp(127.0.0.1:3307)") {
		t.Fatalf("DSN %q should use tcp address", dsn)
	}
}

func TestFromDBEnv_TCPFromEnv(t *testing.T) {
	env := map[string]string{
		"DB_ADDRESS":  "db.example:3306",
		"DB_USER":     "app",
		"DB_PASSWORD": "secret",
		"DB_NAME":     "prod",
	}
	cfg := FromDBEnv(func(k string) string { return env[k] })
	if cfg.Net != "tcp" || cfg.Addr != "db.example:3306" {
		t.Fatalf("Net=%q Addr=%q", cfg.Net, cfg.Addr)
	}
	if cfg.User != "app" || cfg.Passwd != "secret" || cfg.DBName != "prod" {
		t.Fatalf("unexpected overrides")
	}
}

func TestFromDBEnv_UnixSocket(t *testing.T) {
	socket := "/cloudsql/my-project:asia-northeast1:scrum-db"
	env := map[string]string{"DB_SOCKET": socket}
	cfg := FromDBEnv(func(k string) string { return env[k] })
	if cfg.Net != "unix" {
		t.Fatalf("Net = %q, want unix", cfg.Net)
	}
	if cfg.Addr != socket {
		t.Fatalf("Addr = %q, want %q", cfg.Addr, socket)
	}
	dsn := cfg.FormatDSN()
	if !strings.Contains(dsn, "unix("+socket+")") {
		t.Fatalf("DSN %q should use unix socket", dsn)
	}
}

func TestFromDBEnv_SocketOverridesAddress(t *testing.T) {
	env := map[string]string{
		"DB_SOCKET":  "/cloudsql/proj:region:inst",
		"DB_ADDRESS": "ignored:3306",
	}
	cfg := FromDBEnv(func(k string) string { return env[k] })
	if cfg.Net != "unix" {
		t.Fatalf("expected unix when DB_SOCKET is set")
	}
	if cfg.Addr != env["DB_SOCKET"] {
		t.Fatalf("Addr should be socket path, got %q", cfg.Addr)
	}
}

func TestFromDBEnv_EmptySocketUsesTCP(t *testing.T) {
	env := map[string]string{
		"DB_SOCKET":  "   ",
		"DB_ADDRESS": "10.0.0.1:3306",
	}
	cfg := FromDBEnv(func(k string) string { return env[k] })
	if cfg.Net != "tcp" || cfg.Addr != "10.0.0.1:3306" {
		t.Fatalf("whitespace socket should fall back to tcp: Net=%q Addr=%q", cfg.Net, cfg.Addr)
	}
}

func TestForCLI_ImportDSN(t *testing.T) {
	cfg, err := ForCLI(func(k string) string {
		if k == "KANBAN_IMPORT_DSN" {
			return "user:pass@tcp(127.0.0.1:3307)/scrumboard?parseTime=true"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DBName != "scrumboard" || cfg.Addr != "127.0.0.1:3307" {
		t.Fatalf("unexpected cfg: db=%q addr=%q", cfg.DBName, cfg.Addr)
	}
}

func TestForCLI_InvalidDSN(t *testing.T) {
	_, err := ForCLI(func(k string) string {
		if k == "KANBAN_IMPORT_DSN" {
			return "not-a-dsn"
		}
		return ""
	})
	if err == nil || !strings.Contains(err.Error(), "KANBAN_IMPORT_DSN") {
		t.Fatalf("err=%v", err)
	}
}

func TestForCLI_DBEnvUnix(t *testing.T) {
	cfg, err := ForCLI(func(k string) string {
		switch k {
		case "DB_SOCKET":
			return "/cloudsql/proj:asia:db"
		case "DB_USER":
			return "app"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Net != "unix" || cfg.Addr != "/cloudsql/proj:asia:db" || cfg.User != "app" {
		t.Fatalf("unix cfg: net=%q addr=%q user=%q", cfg.Net, cfg.Addr, cfg.User)
	}
}