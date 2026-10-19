-- Migration 002. Nullable keeps every version-1 map unchanged until it is edited.
-- The runner checks information_schema under the schema lock before executing this
-- statement, so a restart between the DDL and the version record is safe.
ALTER TABLE atlas_map ADD COLUMN editor_data JSON NULL;
