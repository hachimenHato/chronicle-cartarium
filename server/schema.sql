-- Immutable migration 001. Later changes belong in migrations/, not only in CREATE.
-- The application never drops or recreates an existing schema.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS workspace_state (
  id INT PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  initialized BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;
INSERT IGNORE INTO workspace_state (id,revision,initialized) VALUES (1,0,FALSE);
CREATE TABLE IF NOT EXISTS world (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(240) NOT NULL,
  subtitle TEXT NOT NULL,
  description MEDIUMTEXT NOT NULL,
  `system` TEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS entity (
  id VARCHAR(100) PRIMARY KEY,
  world_id VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL,
  name VARCHAR(240) NOT NULL,
  summary TEXT NOT NULL,
  content MEDIUMTEXT NOT NULL,
  tags JSON NOT NULL,
  visibility VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL,
  attributes JSON NOT NULL,
  portrait TEXT NULL,
  updated_at VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL,
  INDEX idx_entity_world_type(world_id,type),
  FOREIGN KEY (world_id) REFERENCES world(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS atlas_map (
  id VARCHAR(100) PRIMARY KEY,
  world_id VARCHAR(100) NOT NULL,
  parent_id VARCHAR(100) NULL,
  name VARCHAR(240) NOT NULL,
  summary TEXT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  seed BIGINT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  sort_order INT NOT NULL,
  INDEX idx_map_world(world_id),
  FOREIGN KEY (world_id) REFERENCES world(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES atlas_map(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS map_pin (
  id VARCHAR(100) PRIMARY KEY,
  map_id VARCHAR(100) NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  label VARCHAR(240) NOT NULL,
  description MEDIUMTEXT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  entity_id VARCHAR(100) NULL,
  child_map_id VARCHAR(100) NULL,
  sort_order INT NOT NULL,
  FOREIGN KEY (map_id) REFERENCES atlas_map(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entity(id) ON DELETE SET NULL,
  FOREIGN KEY (child_map_id) REFERENCES atlas_map(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS map_stroke (
  id VARCHAR(100) PRIMARY KEY,
  map_id VARCHAR(100) NOT NULL,
  points JSON NOT NULL,
  color VARCHAR(10) NOT NULL,
  width DOUBLE NOT NULL,
  tool VARCHAR(10) NOT NULL,
  sort_order INT NOT NULL,
  FOREIGN KEY (map_id) REFERENCES atlas_map(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS relation (
  id VARCHAR(100) PRIMARY KEY,
  world_id VARCHAR(100) NOT NULL,
  source_id VARCHAR(100) NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  label VARCHAR(240) NOT NULL,
  description MEDIUMTEXT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  sort_order INT NOT NULL,
  INDEX idx_relation_world(world_id),
  FOREIGN KEY (world_id) REFERENCES world(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES entity(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES entity(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS plot (
  id VARCHAR(100) PRIMARY KEY,
  world_id VARCHAR(100) NOT NULL,
  name VARCHAR(240) NOT NULL,
  summary TEXT NOT NULL,
  sort_order INT NOT NULL,
  INDEX idx_plot_world(world_id),
  FOREIGN KEY (world_id) REFERENCES world(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS plot_node (
  id VARCHAR(100) PRIMARY KEY,
  plot_id VARCHAR(100) NOT NULL,
  title VARCHAR(240) NOT NULL,
  summary MEDIUMTEXT NOT NULL,
  entity_ids JSON NOT NULL,
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  kind VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  conditions JSON NOT NULL,
  condition_mode VARCHAR(10) NOT NULL,
  effects JSON NOT NULL,
  sort_order INT NOT NULL,
  FOREIGN KEY (plot_id) REFERENCES plot(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS plot_edge (
  id VARCHAR(100) PRIMARY KEY,
  plot_id VARCHAR(100) NOT NULL,
  source_id VARCHAR(100) NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL,
  FOREIGN KEY (plot_id) REFERENCES plot(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES plot_node(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES plot_node(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS game_session (
  id VARCHAR(100) PRIMARY KEY,
  world_id VARCHAR(100) NOT NULL,
  title VARCHAR(240) NOT NULL,
  session_date VARCHAR(10) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  sort_order INT NOT NULL,
  INDEX idx_session_world_date(world_id,session_date),
  FOREIGN KEY (world_id) REFERENCES world(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS state_variable (
  id VARCHAR(100) PRIMARY KEY,
  world_id VARCHAR(100) NOT NULL,
  name VARCHAR(240) NOT NULL,
  value TEXT NOT NULL,
  sort_order INT NOT NULL,
  UNIQUE KEY uq_variable_world_name(world_id,name),
  FOREIGN KEY (world_id) REFERENCES world(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT IGNORE INTO schema_migrations(version) VALUES (1);
