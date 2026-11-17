package kanban

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/go-sql-driver/mysql"
)

// InitializeNumbers upgrades both new and existing databases without rewriting cards.
// DDL is restart-safe; the data backfill and counter advance commit atomically.
func (r MySQLRepository) InitializeNumbers(ctx context.Context) error {
	const attempts = 6
	var err error
	for i := 0; i < attempts; i++ {
		err = r.initializeNumbersOnce(ctx)
		if err == nil {
			return nil
		}
		if !isMySQLDeadlock(err) || i == attempts-1 {
			return err
		}
		time.Sleep(time.Duration(i+1) * 25 * time.Millisecond)
	}
	return err
}

func isMySQLDeadlock(err error) bool {
	var m *mysql.MySQLError
	// 1213 deadlock; 1205 lock wait timeout (same contention under concurrent init/create).
	return errors.As(err, &m) && (m.Number == 1213 || m.Number == 1205)
}

func (r MySQLRepository) initializeNumbersOnce(ctx context.Context) error {
	ready, err := r.perProjectNumbersReady(ctx)
	if err != nil {
		return err
	}
	if ready {
		// Schema and counters are current; skip DDL/DML that contends with CreateItem FOR UPDATE.
		return nil
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS item_numbers (
    item_id BIGINT NOT NULL PRIMARY KEY,
    item_number BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    CONSTRAINT fk_item_number FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    CONSTRAINT fk_item_number_project FOREIGN KEY (project_id) REFERENCES projects(id),
    UNIQUE KEY uq_item_numbers_project_number (project_id, item_number),
    CHECK (item_number > 0)
   ) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS item_number_sequence (
    project_id BIGINT NOT NULL PRIMARY KEY,
    next_number BIGINT NOT NULL,
    CONSTRAINT fk_item_number_sequence_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CHECK (next_number > 0)
   ) ENGINE=InnoDB`,
	}
	for _, s := range stmts {
		if _, err := r.DB.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("prepare card numbering: %w", err)
		}
	}
	if err := r.ensureItemNumbersPerProject(ctx); err != nil {
		return err
	}
	if err := r.ensurePerProjectSequenceTable(ctx); err != nil {
		return err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = backfillUnnumberedItems(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

// perProjectNumbersReady is a non-locking check used to avoid init work under CreateItem load.
func (r MySQLRepository) perProjectNumbersReady(ctx context.Context) (bool, error) {
	hasNumProject, err := r.columnExists(ctx, "item_numbers", "project_id")
	if err != nil || !hasNumProject {
		return false, err
	}
	hasSeqProject, err := r.columnExists(ctx, "item_number_sequence", "project_id")
	if err != nil || !hasSeqProject {
		return false, err
	}
	composite, err := r.indexExists(ctx, "item_numbers", "uq_item_numbers_project_number")
	if err != nil || !composite {
		return false, err
	}
	var missing int
	if err = r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM items c
LEFT JOIN item_numbers n ON n.item_id = c.id WHERE n.item_id IS NULL`).Scan(&missing); err != nil {
		return false, err
	}
	if missing > 0 {
		return false, nil
	}
	var behind int
	if err = r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_number_sequence seq
JOIN (
  SELECT project_id, COALESCE(MAX(item_number), 0) + 1 AS nxt FROM item_numbers GROUP BY project_id
) m ON m.project_id = seq.project_id
WHERE seq.next_number < m.nxt`).Scan(&behind); err != nil {
		return false, err
	}
	if behind > 0 {
		return false, nil
	}
	var projects, sequences int
	if err = r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM projects`).Scan(&projects); err != nil {
		return false, err
	}
	if err = r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_number_sequence`).Scan(&sequences); err != nil {
		return false, err
	}
	return sequences >= projects, nil
}

func (r MySQLRepository) ensureItemNumbersPerProject(ctx context.Context) error {
	hasProjectID, err := r.columnExists(ctx, "item_numbers", "project_id")
	if err != nil {
		return err
	}
	if !hasProjectID {
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE item_numbers ADD COLUMN project_id BIGINT NULL`); err != nil {
			return fmt.Errorf("add item_numbers.project_id: %w", err)
		}
	}
	if _, err = r.DB.ExecContext(ctx, `UPDATE item_numbers n JOIN items c ON c.id=n.item_id SET n.project_id=c.project_id`); err != nil {
		return fmt.Errorf("sync item_numbers.project_id: %w", err)
	}
	hasNull := 0
	if err = r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_numbers WHERE project_id IS NULL`).Scan(&hasNull); err != nil {
		return err
	}
	if hasNull > 0 {
		return fmt.Errorf("item_numbers.project_id: %d rows unsynced", hasNull)
	}
	if _, err = r.DB.ExecContext(ctx, `ALTER TABLE item_numbers MODIFY project_id BIGINT NOT NULL`); err != nil {
		return fmt.Errorf("item_numbers.project_id NOT NULL: %w", err)
	}
	composite, err := r.indexExists(ctx, "item_numbers", "uq_item_numbers_project_number")
	if err != nil {
		return err
	}
	if !composite {
		rows, qerr := r.DB.QueryContext(ctx,
			`SELECT INDEX_NAME FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'item_numbers'
AND column_name = 'item_number' AND non_unique = 0
GROUP BY INDEX_NAME HAVING COUNT(DISTINCT column_name) = 1`,
		)
		if qerr != nil {
			return qerr
		}
		for rows.Next() {
			var idx string
			if err = rows.Scan(&idx); err != nil {
				rows.Close()
				return err
			}
			if _, err = r.DB.ExecContext(ctx, fmt.Sprintf("ALTER TABLE item_numbers DROP INDEX %s", idx)); err != nil {
				rows.Close()
				return fmt.Errorf("drop global item_number unique: %w", err)
			}
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		if err = r.renumberItemNumbersPerProject(ctx); err != nil {
			return err
		}
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE item_numbers ADD UNIQUE KEY uq_item_numbers_project_number (project_id, item_number)`); err != nil {
			return fmt.Errorf("add composite unique: %w", err)
		}
	}
	var fk int
	if err = r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'item_numbers'
AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'fk_item_number_project'`,
	).Scan(&fk); err != nil {
		return err
	}
	if fk == 0 {
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE item_numbers
ADD CONSTRAINT fk_item_number_project FOREIGN KEY (project_id) REFERENCES projects(id)`); err != nil {
			return fmt.Errorf("fk item_numbers.project_id: %w", err)
		}
	}
	return nil
}

func (r MySQLRepository) renumberItemNumbersPerProject(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, `UPDATE item_numbers n
JOIN (
  SELECT item_id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY item_number, item_id) AS rn
  FROM item_numbers
) x ON x.item_id = n.item_id
SET n.item_number = x.rn`); err != nil {
		return fmt.Errorf("renumber per project: %w", err)
	}
	return nil
}

func (r MySQLRepository) ensurePerProjectSequenceTable(ctx context.Context) error {
	hasSingleton, err := r.columnExists(ctx, "item_number_sequence", "singleton")
	if err != nil {
		return err
	}
	hasProjectPK, err := r.columnExists(ctx, "item_number_sequence", "project_id")
	if err != nil {
		return err
	}
	if hasSingleton && !hasProjectPK {
		if _, err = r.DB.ExecContext(ctx, `CREATE TABLE item_number_sequence_v2 (
    project_id BIGINT NOT NULL PRIMARY KEY,
    next_number BIGINT NOT NULL,
    CONSTRAINT fk_item_number_sequence_v2_project FOREIGN KEY (project_id) REFERENCES projects(id),
    CHECK (next_number > 0)
   ) ENGINE=InnoDB`); err != nil {
			return fmt.Errorf("create per-project sequence: %w", err)
		}
		if _, err = r.DB.ExecContext(ctx, `INSERT INTO item_number_sequence_v2(project_id, next_number)
SELECT p.id, COALESCE(MAX(n.item_number), 0) + 1
FROM projects p
LEFT JOIN item_numbers n ON n.project_id = p.id
GROUP BY p.id`); err != nil {
			return fmt.Errorf("seed per-project sequence: %w", err)
		}
		if _, err = r.DB.ExecContext(ctx, `DROP TABLE item_number_sequence`); err != nil {
			return err
		}
		if _, err = r.DB.ExecContext(ctx, `RENAME TABLE item_number_sequence_v2 TO item_number_sequence`); err != nil {
			return err
		}
		return nil
	}
	if !hasProjectPK {
		return fmt.Errorf("item_number_sequence: unknown schema")
	}
	// Only insert missing project rows. Avoid rewriting existing next_number under CreateItem locks.
	if _, err = r.DB.ExecContext(ctx, `INSERT IGNORE INTO item_number_sequence(project_id, next_number)
SELECT p.id, COALESCE(MAX(n.item_number), 0) + 1
FROM projects p
LEFT JOIN item_numbers n ON n.project_id = p.id
WHERE NOT EXISTS (SELECT 1 FROM item_number_sequence s WHERE s.project_id = p.id)
GROUP BY p.id`); err != nil {
		return fmt.Errorf("ensure sequence rows: %w", err)
	}
	return nil
}

func backfillUnnumberedItems(ctx context.Context, tx *sql.Tx) error {
	result, err := tx.ExecContext(ctx, `INSERT INTO item_numbers(item_id, item_number, project_id)
SELECT c.id,
  m.base + ROW_NUMBER() OVER (PARTITION BY c.project_id ORDER BY c.created_at, c.id),
  c.project_id
FROM items c
LEFT JOIN item_numbers n ON n.item_id = c.id
JOIN (
  SELECT c2.project_id, COALESCE(MAX(n2.item_number), 0) AS base
  FROM items c2
  LEFT JOIN item_numbers n2 ON n2.item_id = c2.id
  GROUP BY c2.project_id
) m ON m.project_id = c.project_id
WHERE n.item_id IS NULL`)
	if err != nil {
		return fmt.Errorf("backfill item numbers: %w", err)
	}
	if _, err := result.RowsAffected(); err != nil {
		return err
	}
	// Advance only counters that fell behind (avoids rewriting healthy rows under CreateItem FOR UPDATE).
	if _, err := tx.ExecContext(ctx, `UPDATE item_number_sequence seq
JOIN (
  SELECT project_id, COALESCE(MAX(item_number), 0) + 1 AS nxt FROM item_numbers GROUP BY project_id
) m ON m.project_id = seq.project_id
SET seq.next_number = m.nxt
WHERE seq.next_number < m.nxt`); err != nil {
		return err
	}
	return nil
}

// All number issuers lock this project's row until their enclosing transaction commits.
func lockNextNumber(ctx context.Context, tx *sql.Tx, projectID int64) (int64, error) {
	var next int64
	err := tx.QueryRowContext(ctx, "SELECT next_number FROM item_number_sequence WHERE project_id=? FOR UPDATE", projectID).Scan(&next)
	if err == sql.ErrNoRows {
		if _, err = tx.ExecContext(ctx, "INSERT INTO item_number_sequence(project_id, next_number) VALUES(?,1)", projectID); err != nil {
			return 0, err
		}
		err = tx.QueryRowContext(ctx, "SELECT next_number FROM item_number_sequence WHERE project_id=? FOR UPDATE", projectID).Scan(&next)
	}
	return next, err
}