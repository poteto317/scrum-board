package kanban

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	RoleAdmin  = "admin"
	RoleMember = "member"

	BcryptCost = 10

	SessionCookieName = "sb_session"
	SessionTTL        = 14 * 24 * time.Hour

	// HandlerTestSessionID is seeded for unit/integration HTTP tests.
	HandlerTestSessionID = "handler-test-session"
)

var (
	ErrUnauthorized     = errors.New("unauthorized")
	ErrForbidden        = errors.New("forbidden")
	ErrLastAdmin        = errors.New("last admin")
	ErrSelfDisable      = errors.New("self disable")
	ErrLoginNameTaken   = errors.New("login name taken")
	ErrInvalidUserInput = errors.New("invalid user input")
	ErrAuthSeed         = errors.New("auth seed")
)

// User is a workspace account (password hash never leaves the repository layer in JSON).
type User struct {
	ID           int64     `json:"id"`
	LoginName    string    `json:"loginName"`
	DisplayName  string    `json:"displayName"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	Disabled     bool      `json:"disabled"`
	CreatedAt    time.Time `json:"-"`
	UpdatedAt    time.Time `json:"-"`
}

// UserPublic is the list/me JSON shape (no password).
type UserPublic struct {
	ID          int64  `json:"id"`
	LoginName   string `json:"loginName"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Disabled    bool   `json:"disabled"`
}

func (u User) Public() UserPublic {
	return UserPublic{
		ID:          u.ID,
		LoginName:   u.LoginName,
		DisplayName: u.DisplayName,
		Role:        u.Role,
		Disabled:    u.Disabled,
	}
}

// Session is a DB-backed login cookie row.
type Session struct {
	ID        string
	UserID    int64
	ExpiresAt time.Time
	CreatedAt time.Time
}

// UserCreateInput is POST /api/users body (role optional → member).
type UserCreateInput struct {
	LoginName   string
	Password    string
	DisplayName string
	Role        string // empty → member
}

// UserPatch is PATCH /api/users/{id} (nil = omit).
type UserPatch struct {
	DisplayName *string
	Role        *string
	Disabled    *bool
	Password    *string
}

func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	if err != nil {
		return "", ErrInvalidUserInput
	}
	return string(b), nil
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func newSessionID() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func (r MySQLRepository) CountUsers(ctx context.Context) (int64, error) {
	var n int64
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (r MySQLRepository) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT id, login_name, display_name, password_hash, role, disabled, created_at, updated_at
  FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r MySQLRepository) GetUser(ctx context.Context, id int64) (User, error) {
	row := r.DB.QueryRowContext(ctx, `
SELECT id, login_name, display_name, password_hash, role, disabled, created_at, updated_at
  FROM users WHERE id = ?`, id)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (r MySQLRepository) GetUserByLoginName(ctx context.Context, loginName string) (User, error) {
	row := r.DB.QueryRowContext(ctx, `
SELECT id, login_name, display_name, password_hash, role, disabled, created_at, updated_at
  FROM users WHERE login_name = ?`, loginName)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (r MySQLRepository) CreateUser(ctx context.Context, in UserCreateInput) (User, error) {
	in.LoginName = strings.TrimSpace(in.LoginName)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	role := in.Role
	if role == "" {
		role = RoleMember
	}
	if err := validateUserCreate(in, role); err != nil {
		return User{}, err
	}
	hash, err := HashPassword(in.Password)
	if err != nil {
		return User{}, err
	}
	res, err := r.DB.ExecContext(ctx, `
INSERT INTO users (login_name, display_name, password_hash, role, disabled)
VALUES (?, ?, ?, ?, 0)`, in.LoginName, in.DisplayName, hash, role)
	if err != nil {
		if isDuplicateKey(err) {
			return User{}, ErrLoginNameTaken
		}
		return User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return User{}, err
	}
	return r.GetUser(ctx, id)
}

func (r MySQLRepository) UpdateUser(ctx context.Context, id int64, patch UserPatch, actorID int64) (User, error) {
	var newHash string
	passwordChanged := false
	if patch.Password != nil {
		if *patch.Password == "" {
			return User{}, ErrInvalidUserInput
		}
		hash, err := HashPassword(*patch.Password)
		if err != nil {
			return User{}, err
		}
		newHash = hash
		passwordChanged = true
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return User{}, err
	}
	defer func() { _ = tx.Rollback() }()

	row := tx.QueryRowContext(ctx, `
SELECT id, login_name, display_name, password_hash, role, disabled, created_at, updated_at
  FROM users WHERE id=? FOR UPDATE`, id)
	cur, err := scanUser(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, err
	}
	next := cur
	if patch.DisplayName != nil {
		name := strings.TrimSpace(*patch.DisplayName)
		if name == "" || len([]rune(name)) > 80 {
			return User{}, ErrInvalidUserInput
		}
		next.DisplayName = name
	}
	if patch.Role != nil {
		if *patch.Role != RoleAdmin && *patch.Role != RoleMember {
			return User{}, ErrInvalidUserInput
		}
		next.Role = *patch.Role
	}
	if patch.Disabled != nil {
		next.Disabled = *patch.Disabled
	}
	if passwordChanged {
		next.PasswordHash = newHash
	}
	if err := validateUserMutation(ctx, txAdminCounter{tx}, cur, next, actorID); err != nil {
		return User{}, err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE users SET display_name=?, password_hash=?, role=?, disabled=? WHERE id=?`,
		next.DisplayName, next.PasswordHash, next.Role, boolToTiny(next.Disabled), id)
	if err != nil {
		return User{}, err
	}
	if (next.Disabled && !cur.Disabled) || passwordChanged {
		if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, id); err != nil {
			return User{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return User{}, err
	}
	return r.GetUser(ctx, id)
}

type txAdminCounter struct{ tx *sql.Tx }

// CountEnabledAdmins locks enabled admin rows so concurrent demotions cannot both pass last-admin checks.
func (c txAdminCounter) CountEnabledAdmins(ctx context.Context) (int64, error) {
	rows, err := c.tx.QueryContext(ctx, `
SELECT id FROM users WHERE role = ? AND disabled = 0 ORDER BY id FOR UPDATE`, RoleAdmin)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var n int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		n++
	}
	return n, rows.Err()
}

func (r MySQLRepository) CountEnabledAdmins(ctx context.Context) (int64, error) {
	var n int64
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM users WHERE role = ? AND disabled = 0`, RoleAdmin).Scan(&n)
	return n, err
}

func (r MySQLRepository) CreateSession(ctx context.Context, userID int64, now time.Time) (Session, error) {
	id, err := newSessionID()
	if err != nil {
		return Session{}, err
	}
	exp := now.Add(SessionTTL)
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`, id, userID, exp)
	if err != nil {
		return Session{}, err
	}
	return Session{ID: id, UserID: userID, ExpiresAt: exp, CreatedAt: now}, nil
}

func (r MySQLRepository) DeleteSession(ctx context.Context, id string) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM sessions WHERE id = ?`, id)
	return err
}

func (r MySQLRepository) DeleteSessionsForUser(ctx context.Context, userID int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ?`, userID)
	return err
}

func (r MySQLRepository) UserBySessionID(ctx context.Context, sessionID string, now time.Time) (User, error) {
	row := r.DB.QueryRowContext(ctx, `
SELECT u.id, u.login_name, u.display_name, u.password_hash, u.role, u.disabled, u.created_at, u.updated_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
 WHERE s.id = ? AND s.expires_at > ?`, sessionID, now)
	u, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrUnauthorized
	}
	if err != nil {
		return User{}, err
	}
	if u.Disabled {
		return User{}, ErrUnauthorized
	}
	return u, nil
}

type userScanner interface {
	Scan(dest ...any) error
}

func scanUser(s userScanner) (User, error) {
	var u User
	var disabled int
	err := s.Scan(&u.ID, &u.LoginName, &u.DisplayName, &u.PasswordHash, &u.Role, &disabled, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return User{}, err
	}
	u.Disabled = disabled != 0
	return u, nil
}

func boolToTiny(v bool) int {
	if v {
		return 1
	}
	return 0
}

func isDuplicateKey(err error) bool {
	return err != nil && strings.Contains(err.Error(), "Duplicate")
}

func validateUserCreate(in UserCreateInput, role string) error {
	login := strings.TrimSpace(in.LoginName)
	display := strings.TrimSpace(in.DisplayName)
	if login == "" || display == "" || in.Password == "" {
		return ErrInvalidUserInput
	}
	if len([]rune(login)) > 80 || len([]rune(display)) > 80 {
		return ErrInvalidUserInput
	}
	if role != RoleAdmin && role != RoleMember {
		return ErrInvalidUserInput
	}
	return nil
}

type adminCounter interface {
	CountEnabledAdmins(ctx context.Context) (int64, error)
}

func validateUserMutation(ctx context.Context, counter adminCounter, cur, next User, actorID int64) error {
	if next.Disabled && actorID == cur.ID {
		return ErrSelfDisable
	}
	losingAdmin := cur.Role == RoleAdmin && !cur.Disabled &&
		(next.Disabled || next.Role != RoleAdmin)
	if !losingAdmin {
		return nil
	}
	n, err := counter.CountEnabledAdmins(ctx)
	if err != nil {
		return err
	}
	if n <= 1 {
		return ErrLastAdmin
	}
	return nil
}

// SeedAdminFromEnv creates one admin from AUTH_USER/AUTH_PASSWORD when users is empty.
// When users > 0, AUTH may be missing (seed is a no-op). When users == 0, both AUTH vars are required.
func (r MySQLRepository) SeedAdminFromEnv(ctx context.Context, getenv func(string) string) error {
	n, err := r.CountUsers(ctx)
	if err != nil {
		return fmt.Errorf("count users: %w", err)
	}
	if n > 0 {
		return nil
	}
	user := strings.TrimSpace(getenv("AUTH_USER"))
	pass := getenv("AUTH_PASSWORD")
	if user == "" || pass == "" {
		return fmt.Errorf("%w: AUTH_USER and AUTH_PASSWORD are required when users is empty", ErrAuthSeed)
	}
	hash, err := HashPassword(pass)
	if err != nil {
		return fmt.Errorf("%w: password hash failed", ErrAuthSeed)
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO users (login_name, display_name, password_hash, role, disabled)
VALUES (?, ?, ?, ?, 0)`, user, user, hash, RoleAdmin)
	if err != nil {
		return fmt.Errorf("%w: insert admin failed", ErrAuthSeed)
	}
	return nil
}
