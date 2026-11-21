package kanban

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	AIRoleUser      = "user"
	AIRoleAssistant = "assistant"

	maxAIChatMessageLen     = 4000
	maxAIChatHistoryTurns   = 20
	maxAIChatStoredMessages = 200
)

// AIMessage is one stored chat message on an item.
type AIMessage struct {
	ID           int64     `json:"id"`
	ItemID       int64     `json:"itemId"`
	Role         string    `json:"role"`
	Body         string    `json:"body"`
	InputTokens  *int      `json:"inputTokens,omitempty"`
	OutputTokens *int      `json:"outputTokens,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// AIUsage is the workspace-wide cumulative AI usage counters.
type AIUsage struct {
	RequestCount int64  `json:"requestCount"`
	InputTokens  int64  `json:"inputTokens"`
	OutputTokens int64  `json:"outputTokens"`
	// LimitTokens is the optional workspace token budget (input+output). nil = unlimited.
	LimitTokens *int64 `json:"limitTokens,omitempty"`
}

// UsedTokens is input+output cumulative tokens.
func (u AIUsage) UsedTokens() int64 {
	return u.InputTokens + u.OutputTokens
}

// CreditLimitExceeded is true when a limit is set and used tokens have reached it.
func (u AIUsage) CreditLimitExceeded() bool {
	if u.LimitTokens == nil {
		return false
	}
	return u.UsedTokens() >= *u.LimitTokens
}

// AICreditsView is the GET/PUT /api/ai/credits response body.
type AICreditsView struct {
	LimitTokens     *int64 `json:"limitTokens"`
	UsedTokens      int64  `json:"usedTokens"`
	RemainingTokens *int64 `json:"remainingTokens"`
	Unlimited       bool   `json:"unlimited"`
	Approximate     bool   `json:"approximate"`
	Period          string `json:"period"`
	Configured      bool   `json:"configured"`
}

// BuildAICreditsView maps usage counters into the credits API view.
func BuildAICreditsView(u AIUsage, configured bool) AICreditsView {
	v := AICreditsView{
		UsedTokens:  u.UsedTokens(),
		Approximate: true,
		Period:      "cumulative",
		Configured:  configured,
	}
	if u.LimitTokens == nil {
		v.Unlimited = true
		return v
	}
	lim := *u.LimitTokens
	v.LimitTokens = &lim
	rem := lim - v.UsedTokens
	if rem < 0 {
		rem = 0
	}
	v.RemainingTokens = &rem
	return v
}

// NormalizeAIChatMessage trims; empty after trim is invalid. ok is false when empty, too long, or control chars.
func NormalizeAIChatMessage(raw string) (value string, ok bool) {
	value = strings.TrimSpace(raw)
	if value == "" {
		return "", false
	}
	if utf8.RuneCountInString(value) > maxAIChatMessageLen {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\r' {
			return "", false
		}
	}
	return value, true
}

func (r MySQLRepository) ListAIMessages(ctx context.Context, itemID int64) ([]AIMessage, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, item_id, role, body, input_tokens, output_tokens, created_at
 FROM item_ai_messages WHERE item_id=? ORDER BY created_at ASC, id ASC`, itemID)
	if err != nil {
		return nil, fmt.Errorf("list ai messages: %w", err)
	}
	defer rows.Close()
	out := make([]AIMessage, 0)
	for rows.Next() {
		m, err := scanAIMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r MySQLRepository) AppendAITurn(ctx context.Context, itemID int64, userBody, assistantBody string, inTok, outTok int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var count int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_ai_messages WHERE item_id=?`, itemID).Scan(&count); err != nil {
		return fmt.Errorf("count ai messages: %w", err)
	}
	overflow := count + 2 - maxAIChatStoredMessages
	if overflow > 0 {
		if _, err = tx.ExecContext(ctx, `DELETE FROM item_ai_messages WHERE item_id=? ORDER BY created_at ASC, id ASC LIMIT ?`, itemID, overflow); err != nil {
			return fmt.Errorf("trim ai messages: %w", err)
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO item_ai_messages(item_id, role, body) VALUES (?,?,?)`, itemID, AIRoleUser, userBody); err != nil {
		return fmt.Errorf("append user ai message: %w", err)
	}
	var inPtr, outPtr any
	if inTok > 0 {
		inPtr = int(inTok)
	}
	if outTok > 0 {
		outPtr = int(outTok)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO item_ai_messages(item_id, role, body, input_tokens, output_tokens) VALUES (?,?,?,?,?)`,
		itemID, AIRoleAssistant, assistantBody, inPtr, outPtr); err != nil {
		return fmt.Errorf("append assistant ai message: %w", err)
	}
	return tx.Commit()
}

func (r MySQLRepository) ClearAIMessages(ctx context.Context, itemID int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM item_ai_messages WHERE item_id=?`, itemID)
	if err != nil {
		return fmt.Errorf("clear ai messages: %w", err)
	}
	return nil
}

func (r MySQLRepository) AddAIUsage(ctx context.Context, requests, inTok, outTok int64) error {
	_, err := r.DB.ExecContext(ctx, `INSERT INTO ai_usage (id, request_count, input_tokens, output_tokens) VALUES (1, ?, ?, ?)
 ON DUPLICATE KEY UPDATE
 request_count = request_count + VALUES(request_count),
 input_tokens = input_tokens + VALUES(input_tokens),
 output_tokens = output_tokens + VALUES(output_tokens)`, requests, inTok, outTok)
	if err != nil {
		return fmt.Errorf("add ai usage: %w", err)
	}
	return nil
}

func (r MySQLRepository) GetAIUsage(ctx context.Context) (AIUsage, error) {
	var u AIUsage
	var lim sql.NullInt64
	err := r.DB.QueryRowContext(ctx, `SELECT request_count, input_tokens, output_tokens, limit_tokens FROM ai_usage WHERE id=1`).Scan(
		&u.RequestCount, &u.InputTokens, &u.OutputTokens, &lim)
	if err == sql.ErrNoRows {
		return AIUsage{}, nil
	}
	if err != nil {
		return AIUsage{}, fmt.Errorf("get ai usage: %w", err)
	}
	if lim.Valid {
		v := lim.Int64
		u.LimitTokens = &v
	}
	return u, nil
}

func (r MySQLRepository) SetAICreditLimit(ctx context.Context, limit *int64) error {
	if limit != nil && *limit < 0 {
		return fmt.Errorf("set ai credit limit: negative")
	}
	_, err := r.DB.ExecContext(ctx, `INSERT INTO ai_usage (id, request_count, input_tokens, output_tokens, limit_tokens) VALUES (1, 0, 0, 0, ?)
 ON DUPLICATE KEY UPDATE limit_tokens = VALUES(limit_tokens)`, limit)
	if err != nil {
		return fmt.Errorf("set ai credit limit: %w", err)
	}
	return nil
}

type aiMessageScanner interface {
	Scan(dest ...any) error
}

func scanAIMessage(s aiMessageScanner) (AIMessage, error) {
	var m AIMessage
	var inTok, outTok sql.NullInt64
	err := s.Scan(&m.ID, &m.ItemID, &m.Role, &m.Body, &inTok, &outTok, &m.CreatedAt)
	if err != nil {
		return AIMessage{}, err
	}
	if inTok.Valid {
		v := int(inTok.Int64)
		m.InputTokens = &v
	}
	if outTok.Valid {
		v := int(outTok.Int64)
		m.OutputTokens = &v
	}
	return m, nil
}
