SET NAMES utf8mb4;
CREATE TABLE board_columns (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(60) NOT NULL,
 position INT NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY unique_column_name (name)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE cards (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 column_id BIGINT NOT NULL,
 title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 backlog_position INT NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 CONSTRAINT fk_card_column FOREIGN KEY (column_id) REFERENCES board_columns(id),
 INDEX cards_order (created_at,id),
 INDEX cards_column (column_id),
 INDEX cards_backlog_position (backlog_position, id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- IDs are used as the final sort key, so later columns naturally append.
INSERT INTO board_columns(id,name) VALUES (1,'Todo'),(2,'Doing'),(3,'Done');
INSERT INTO cards(column_id,title,description) VALUES
(1,'ドラッグ＆ドロップでカードの移動・並べ替えを実装する','今後の拡張機能。カードを別のステータスへドラッグして移動し、列内の順番も変更できるようにする。MVPでは詳細画面のステータス選択で移動する。');
