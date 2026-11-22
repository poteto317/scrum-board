package kanban

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

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

	adminPlain := "seed-admin-password"
	basicPlain := "seed-basic-password"
	env := map[string]string{
		"AUTH_USER":               "seedadmin",
		"AUTH_PASSWORD":           basicPlain,
		"ADMIN_INITIAL_PASSWORD":  adminPlain,
	}
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
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(adminPlain)) != nil {
		t.Fatal("password hash does not match ADMIN_INITIAL_PASSWORD")
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(basicPlain)) == nil {
		t.Fatal("hash must not match AUTH_PASSWORD")
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

func TestSeedAdminFromEnvRequiresCredentialsWhenEmpty(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}

	err := r.SeedAdminFromEnv(ctx, func(string) string { return "" })
	if err == nil || !errors.Is(err, ErrAuthSeed) {
		t.Fatalf("want ErrAuthSeed, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "AUTH_USER") || !strings.Contains(msg, "ADMIN_INITIAL_PASSWORD") {
		t.Fatalf("want both AUTH_USER and ADMIN_INITIAL_PASSWORD in error, got %v", err)
	}

	// AUTH_USER+AUTH_PASSWORD set but ADMIN_INITIAL_PASSWORD empty must not fall back (L-462).
	env := map[string]string{"AUTH_USER": "u", "AUTH_PASSWORD": "basic-only-secret"}
	err = r.SeedAdminFromEnv(ctx, func(k string) string { return env[k] })
	if err == nil || !errors.Is(err, ErrAuthSeed) {
		t.Fatalf("want ErrAuthSeed when ADMIN_INITIAL_PASSWORD missing, got %v", err)
	}
	if !strings.Contains(err.Error(), "ADMIN_INITIAL_PASSWORD") {
		t.Fatalf("want ADMIN_INITIAL_PASSWORD in error, got %v", err)
	}
	if strings.Contains(err.Error(), "basic-only-secret") {
		t.Fatalf("error leaked secret material: %v", err)
	}
}

func TestSeedAdminFromEnvRejectsSameAsAUTHPassword(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}

	same := "shared-secret-value"
	env := map[string]string{
		"AUTH_USER":              "seedadmin",
		"AUTH_PASSWORD":          same,
		"ADMIN_INITIAL_PASSWORD": same,
	}
	err := r.SeedAdminFromEnv(ctx, func(k string) string { return env[k] })
	if err == nil || !errors.Is(err, ErrAuthSeed) {
		t.Fatalf("want ErrAuthSeed for identical passwords, got %v", err)
	}
	if !strings.Contains(err.Error(), "must differ") {
		t.Fatalf("want fixed differ message, got %v", err)
	}
	if strings.Contains(err.Error(), same) {
		t.Fatalf("error leaked password value: %v", err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("users should stay empty: n=%d err=%v", n, err)
	}
}

func TestSeedAdminFromEnvWhitespaceOnlyPasswordSeeds(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}

	env := map[string]string{
		"AUTH_USER":              "seedadmin",
		"AUTH_PASSWORD":          "", // avoid same-value reject
		"ADMIN_INITIAL_PASSWORD": "   ",
	}
	if err := r.SeedAdminFromEnv(ctx, func(k string) string { return env[k] }); err != nil {
		t.Fatalf("whitespace-only admin password should seed: %v", err)
	}
	var hash string
	if err := db.QueryRow(`SELECT password_hash FROM users LIMIT 1`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("   ")) != nil {
		t.Fatal("hash must match untrimmed whitespace password")
	}
}

func TestSeedAdminFromEnvTrailingSpaceDiffersFromAUTHPassword(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	dropUsersTables(t, db)
	if err := r.InitializeUsers(ctx); err != nil {
		t.Fatal(err)
	}

	env := map[string]string{
		"AUTH_USER":              "seedadmin",
		"AUTH_PASSWORD":          "secret",
		"ADMIN_INITIAL_PASSWORD": "secret ",
	}
	if err := r.SeedAdminFromEnv(ctx, func(k string) string { return env[k] }); err != nil {
		t.Fatalf("trailing-space difference should allow seed: %v", err)
	}
	var hash string
	if err := db.QueryRow(`SELECT password_hash FROM users LIMIT 1`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("secret ")) != nil {
		t.Fatal("hash must match ADMIN_INITIAL_PASSWORD including trailing space")
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte("secret")) == nil {
		t.Fatal("hash must not match AUTH_PASSWORD without trailing space")
	}
}

func TestAdminSeedCredsPure(t *testing.T) {
	login, pass, err := adminSeedCreds(func(k string) string {
		return map[string]string{
			"AUTH_USER":              "  admin  ",
			"AUTH_PASSWORD":          "basic",
			"ADMIN_INITIAL_PASSWORD": "admin-pass",
		}[k]
	})
	if err != nil || login != "admin" || pass != "admin-pass" {
		t.Fatalf("got login=%q pass=%q err=%v", login, pass, err)
	}
	_, _, err = adminSeedCreds(func(k string) string {
		return map[string]string{"AUTH_USER": "u", "AUTH_PASSWORD": "same", "ADMIN_INITIAL_PASSWORD": "same"}[k]
	})
	if err == nil || !errors.Is(err, ErrAuthSeed) {
		t.Fatalf("want ErrAuthSeed for same passwords, got %v", err)
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
