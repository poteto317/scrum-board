package kanban

import (
	"context"
	"fmt"
)

// InitializeProjects creates projects, seeds 「メイン」 when the table is empty,
// and backfills items.project_id without rewriting item ids or created_at (L-456).
// A deleted project id is never reused (L-455): the seed insert does not set an id.
func (r MySQLRepository) InitializeProjects(ctx context.Context) error {
	if err := r.ensureProjectsTable(ctx); err != nil {
		return err
	}
	if err := r.seedDefaultProject(ctx); err != nil {
		return err
	}
	return r.migrateItemsProjectID(ctx)
}

func (r MySQLRepository) ensureProjectsTable(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS projects (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 position INT NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
	if err != nil {
		return fmt.Errorf("create projects: %w", err)
	}
	return nil
}

func (r MySQLRepository) seedDefaultProject(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, `
INSERT INTO projects(name, position)
SELECT 'メイン', 0
 WHERE NOT EXISTS (SELECT 1 FROM projects)`); err != nil {
		return fmt.Errorf("seed projects: %w", err)
	}
	return nil
}

func (r MySQLRepository) migrateItemsProjectID(ctx context.Context) error {
	exists, err := r.columnExists(ctx, "items", "project_id")
	if err != nil {
		return fmt.Errorf("check items.project_id: %w", err)
	}
	if !exists {
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE items ADD COLUMN project_id BIGINT NULL`); err != nil {
			return fmt.Errorf("add items.project_id: %w", err)
		}
	}
	// Only NULL rows are assigned. Existing project_id, id, and created_at stay put.
	if _, err = r.DB.ExecContext(ctx, `
UPDATE items i
JOIN (SELECT id FROM projects ORDER BY position, id LIMIT 1) p
SET i.project_id=p.id, i.updated_at=i.updated_at
WHERE i.project_id IS NULL`); err != nil {
		return fmt.Errorf("backfill items.project_id: %w", err)
	}
	nullable, err := r.projectIDNullable(ctx)
	if err != nil {
		return err
	}
	if nullable {
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE items MODIFY project_id BIGINT NOT NULL`); err != nil {
			return fmt.Errorf("items.project_id NOT NULL: %w", err)
		}
	}
	fk, err := r.foreignKeyExists(ctx, "items", "fk_item_project")
	if err != nil {
		return fmt.Errorf("check fk_item_project: %w", err)
	}
	if !fk {
		if _, err = r.DB.ExecContext(ctx, `
ALTER TABLE items
ADD CONSTRAINT fk_item_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`); err != nil {
			return fmt.Errorf("add fk_item_project: %w", err)
		}
	}
	indexed, err := r.indexExists(ctx, "items", "items_project_position")
	if err != nil {
		return fmt.Errorf("check items_project_position: %w", err)
	}
	if !indexed {
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE items ADD INDEX items_project_position (project_id, column_id, position, id)`); err != nil {
			return fmt.Errorf("add items_project_position: %w", err)
		}
	}
	return nil
}

func (r MySQLRepository) projectIDNullable(ctx context.Context) (bool, error) {
	var nullable string
	err := r.DB.QueryRowContext(ctx, `
SELECT IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'project_id'`).Scan(&nullable)
	if err != nil {
		return false, fmt.Errorf("check items.project_id nullability: %w", err)
	}
	return nullable == "YES", nil
}
