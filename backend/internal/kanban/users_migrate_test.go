package kanban

import (
	"context"
	"strings"
	"testing"

	"database/sql"
	"golang.org/x/crypto/bcrypt"
)

func dropUsersTables(t *testing.T, db *sql.DB) {
	t.Helper()
	mustExec(t, db, `DROP TABLE IF EXISTS item_acl_entries`)
	mustExec(t, db, `ALTER TABLE items DROP FOREIGN KEY fk_items_created_by`)
	mustExec(t, db, `DROP TABLE IF EXISTS sessions`)
	mustExec(t, db, `DROP TABLE IF EXISTS users`)
}

func TestInitializeUsersAndSessionsIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeSessions(ctx); err != nil {
		t.Fatal(err)
	}
	var users, sessions int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users'`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("users missing: count=%d err=%v", users, err)
	}
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='sessions'`).Scan(&sessions); err != nil || sessions != 1 {
		t.Fatalf("sessions missing: count=%d err=%v", sessions, err)
	}
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeSessions(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestSeedAdminFromEnvMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeSessions(ctx); err != nil {
		t.Fatal(err)
	}

	plain := "seed-secret-password"
	env := map[string]string{"AUTH_USER": "seedadmin", "AUTH_PASSWORD": plain}
	getenv := func(k string) string { return env[k] }

	if err := r.SeedAdminFromEnv(ctx, getenv); err != nil {
		t.Fatal(err)
	}
	var n int
	var hash, role string
	var disabled int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT password_hash, role, disabled FROM users LIMIT 1`).Scan(&hash, &role, &disabled); err != nil {
		t.Fatal(err)
	}
	if n != 1 || role != RoleAdmin || disabled != 0 {
		t.Fatalf("seed row: n=%d role=%s disabled=%d", n, role, disabled)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) != nil {
		t.Fatal("password hash does not match at cost check")
	}
	cost, err := bcrypt.Cost([]byte(hash))
	if err != nil || cost != BcryptCost {
		t.Fatalf("bcrypt cost=%d err=%v want %d", cost, err, BcryptCost)
	}

	if err := r.SeedAdminFromEnv(ctx, getenv); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("re-seed grew users: n=%d err=%v", n, err)
	}
}

func TestSeedAdminFromEnvRequiresAUTHWhenEmpty(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}

	err := r.SeedAdminFromEnv(ctx, func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "AUTH_USER") {
		t.Fatalf("want AUTH required error, got %v", err)
	}
	if strings.Contains(err.Error(), "seed-secret") || strings.Contains(err.Error(), "password") && strings.Contains(err.Error(), "plain") {
		t.Fatalf("error leaked secret material: %v", err)
	}
}

func TestSeedAdminFromEnvNoOpWhenUsersExistWithoutAUTH(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}
	hash, err := HashPassword("already")
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `INSERT INTO users (login_name, display_name, password_hash, role, disabled) VALUES ('u','u',?, 'admin', 0)`, hash)

	if err := r.SeedAdminFromEnv(ctx, func(string) string { return "" }); err != nil {
		t.Fatalf("expected no-op success, got %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}
