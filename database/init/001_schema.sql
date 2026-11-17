SET NAMES utf8mb4;
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
 title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 position INT NOT NULL DEFAULT 0,
 offset_y INT NOT NULL DEFAULT 0,
 backlog_position INT NOT NULL DEFAULT 0,
 assignee VARCHAR(60) NOT NULL DEFAULT '',
 close_reason TEXT NOT NULL DEFAULT (''),
 due_at DATETIME NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_item_column FOREIGN KEY (column_id) REFERENCES board_columns(id),
 INDEX items_column_position (column_id, position, id),
 INDEX items_backlog_position (backlog_position, id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE board_settings (
 setting_key VARCHAR(64) PRIMARY KEY,
 setting_value VARCHAR(255) NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
INSERT INTO board_settings(setting_key, setting_value) VALUES ('card_layout', 'pack');
-- IDs are used as the final sort key, so later columns naturally append.
INSERT INTO board_columns(id,name) VALUES (1,'Todo'),(2,'Doing'),(3,'Done');
INSERT INTO items(column_id,title,description) VALUES
(1,'ドラッグ＆ドロップでカードの移動・並べ替えを実装する','ボード上でカードをドラッグして列内の順番変更と別ステータスへの移動ができる。短いドラッグは詳細へ遷移する。詳細画面のステータス選択でも移動でき、移動先列の末尾に並ぶ。');
