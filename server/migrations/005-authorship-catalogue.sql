-- Each column is inspected individually by ensureSchema to resume interrupted DDL.
ALTER TABLE world ADD COLUMN entity_types JSON NULL;
ALTER TABLE entity ADD COLUMN created_by VARCHAR(100) NULL;
ALTER TABLE entity ADD COLUMN cover TEXT NULL;
ALTER TABLE entity ADD COLUMN graph_position JSON NULL;
ALTER TABLE atlas_map ADD COLUMN created_by VARCHAR(100) NULL;
ALTER TABLE atlas_map ADD COLUMN visibility VARCHAR(10) NULL;
ALTER TABLE relation ADD COLUMN created_by VARCHAR(100) NULL;
ALTER TABLE relation ADD COLUMN visibility VARCHAR(10) NULL;
ALTER TABLE plot ADD COLUMN created_by VARCHAR(100) NULL;
ALTER TABLE plot ADD COLUMN visibility VARCHAR(10) NULL;
ALTER TABLE plot ADD COLUMN layout_version INT NULL;
ALTER TABLE game_session ADD COLUMN created_by VARCHAR(100) NULL;
ALTER TABLE game_session ADD COLUMN visibility VARCHAR(10) NULL;
ALTER TABLE state_variable ADD COLUMN created_by VARCHAR(100) NULL;
ALTER TABLE state_variable ADD COLUMN visibility VARCHAR(10) NULL;
