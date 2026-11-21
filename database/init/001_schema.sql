SET NAMES utf8mb4;
CREATE TABLE projects (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 position INT NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
INSERT INTO projects(id, name, position) VALUES (1, 'メイン', 0);
CREATE TABLE board_columns (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(60) NOT NULL,
 position INT NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY unique_column_name (name)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE items (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 column_id BIGINT NOT NULL,
 project_id BIGINT NOT NULL,
 title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 solution TEXT NOT NULL DEFAULT (''),
 position INT NOT NULL DEFAULT 0,
 offset_y INT NOT NULL DEFAULT 0,
 backlog_position INT NOT NULL DEFAULT 0,
 assignee VARCHAR(60) NOT NULL DEFAULT '',
 close_reason TEXT NOT NULL DEFAULT (''),
 favorite TINYINT(1) NOT NULL DEFAULT 0,
 due_at DATETIME NULL,
 deleted_at DATETIME(6) NULL,
 view_access VARCHAR(16) NOT NULL DEFAULT 'open',
 edit_access VARCHAR(16) NOT NULL DEFAULT 'open',
 created_by_user_id BIGINT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_item_column FOREIGN KEY (column_id) REFERENCES board_columns(id),
 CONSTRAINT fk_item_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
 INDEX items_column_position (column_id, position, id),
 INDEX items_backlog_position (backlog_position, id),
 INDEX items_project_position (project_id, column_id, position, id),
 INDEX items_project_deleted_at (project_id, deleted_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE board_settings (
 setting_key VARCHAR(64) PRIMARY KEY,
 setting_value VARCHAR(255) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
INSERT INTO board_settings(setting_key, setting_value) VALUES ('card_layout', 'pack'), ('active_project_id', '1');
-- IDs are used as the final sort key, so later columns naturally append.
INSERT INTO board_columns(id,name) VALUES (1,'Todo'),(2,'Doing'),(3,'Done');
INSERT INTO items(column_id,title,description,project_id) VALUES
(1,'ドラッグ＆ドロップでカードの移動・並べ替えを実装する','ボード上でカードをドラッグして列内の順番変更と別ステータスへの移動ができる。短いドラッグは詳細へ遷移する。詳細画面のステータス選択でも移動でき、移動先列の末尾に並ぶ。',1);
-- Keep in sync with backend/internal/kanban/comment_migrate.go (itemCommentsDDL).
CREATE TABLE IF NOT EXISTS item_comments (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 item_id BIGINT NOT NULL,
 author VARCHAR(60) NOT NULL DEFAULT '',
 body TEXT NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_comment_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 INDEX comments_item_created (item_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- Keep in sync with backend/internal/kanban/users_migrate.go (usersDDL / sessionsDDL).
CREATE TABLE IF NOT EXISTS users (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 login_name VARCHAR(80) NOT NULL,
 display_name VARCHAR(80) NOT NULL,
 password_hash VARCHAR(100) NOT NULL,
 role VARCHAR(16) NOT NULL,
 disabled TINYINT(1) NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_users_login_name (login_name),
 CONSTRAINT chk_users_role CHECK (role IN ('admin', 'member'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS sessions (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 user_id BIGINT NOT NULL,
 expires_at DATETIME(6) NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 INDEX sessions_user_id (user_id),
 INDEX sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- Keep in sync with backend/internal/kanban/item_acl_migrate.go
ALTER TABLE items
  ADD CONSTRAINT fk_items_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS item_acl_entries (
 item_id BIGINT NOT NULL,
 user_id BIGINT NOT NULL,
 capability VARCHAR(8) NOT NULL,
 PRIMARY KEY (item_id, user_id, capability),
 CONSTRAINT fk_item_acl_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 CONSTRAINT fk_item_acl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT chk_item_acl_capability CHECK (capability IN ('view', 'edit'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- Keep in sync with backend/internal/kanban/sprint_migrate.go (sprintsDDL / sprintItemsDDL).
CREATE TABLE IF NOT EXISTS sprints (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 project_id BIGINT NOT NULL,
 name VARCHAR(120) NOT NULL,
 goal TEXT NOT NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 status VARCHAR(16) NOT NULL,
 velocity INT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_sprints_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
 INDEX sprints_project_status (project_id, status),
 INDEX sprints_project_start (project_id, start_date DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS sprint_items (
 sprint_id BIGINT NOT NULL,
 item_id BIGINT NOT NULL,
 position INT NOT NULL,
 PRIMARY KEY (sprint_id, item_id),
 CONSTRAINT fk_sprint_items_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
 CONSTRAINT fk_sprint_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 INDEX sprint_items_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- Keep in sync with backend/internal/kanban/recurring_migrate.go (recurringRulesDDL).
CREATE TABLE IF NOT EXISTS recurring_rules (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 project_id BIGINT NOT NULL,
 name VARCHAR(80) NOT NULL,
 title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 cron VARCHAR(64) NOT NULL,
 timezone VARCHAR(64) NOT NULL,
 column_id BIGINT NOT NULL,
 enabled TINYINT(1) NOT NULL DEFAULT 1,
 last_fired_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_recurring_rules_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
 INDEX recurring_rules_project_id (project_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- Keep in sync with backend/internal/kanban/ai_chat_migrate.go (itemAIMessagesDDL / aiUsageDDL).
CREATE TABLE IF NOT EXISTS item_ai_messages (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 item_id BIGINT NOT NULL,
 role VARCHAR(16) NOT NULL,
 body TEXT NOT NULL,
 input_tokens INT NULL,
 output_tokens INT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_ai_message_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 CONSTRAINT chk_ai_message_role CHECK (role IN ('user', 'assistant')),
 INDEX ai_messages_item_created (item_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE IF NOT EXISTS ai_usage (
 id TINYINT NOT NULL PRIMARY KEY,
 request_count BIGINT NOT NULL DEFAULT 0,
 input_tokens BIGINT NOT NULL DEFAULT 0,
 output_tokens BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT IGNORE INTO ai_usage (id, request_count, input_tokens, output_tokens) VALUES (1, 0, 0, 0);
-- Keep in sync with backend/internal/kanban/attachment_migrate.go (itemAttachmentsDDL).
CREATE TABLE IF NOT EXISTS item_attachments (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 item_id BIGINT NOT NULL,
 comment_id BIGINT NULL,
 field VARCHAR(16) NOT NULL,
 object_key VARCHAR(512) NOT NULL,
 content_type VARCHAR(64) NOT NULL,
 byte_size INT NOT NULL,
 original_name VARCHAR(200) NOT NULL,
 created_by_user_id BIGINT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_attachment_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 CONSTRAINT fk_attachment_comment FOREIGN KEY (comment_id) REFERENCES item_comments(id) ON DELETE CASCADE,
 UNIQUE KEY uq_attachment_object_key (object_key),
 INDEX attachments_item_id (item_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
