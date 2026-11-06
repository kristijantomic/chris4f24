CREATE TYPE node_type AS ENUM ('folder', 'file');

CREATE TABLE nodes (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  type        node_type NOT NULL,
  name        varchar(255) NOT NULL,
  parent_id   uuid,  -- NULL means root level
  parent_type node_type NOT NULL DEFAULT 'folder'
              CONSTRAINT nodes_parent_is_folder CHECK (parent_type = 'folder'),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT nodes_id_type_key UNIQUE (id, type),
  CONSTRAINT nodes_parent_fk FOREIGN KEY (parent_id, parent_type)
    REFERENCES nodes (id, type) ON DELETE CASCADE,
  CONSTRAINT nodes_name_valid CHECK (
    char_length(name) BETWEEN 1 AND 255
    AND name = btrim(name)
    AND name NOT IN ('.', '..')
    AND strpos(name, '/') = 0
    AND strpos(name, chr(92)) = 0  -- backslash; chr() survives any SQL client's escaping
    AND name !~ '[[:cntrl:]]'
    AND name IS NFC NORMALIZED
  )
);

-- Name uniqueness across files and folders; also serves folder listing
CREATE UNIQUE INDEX nodes_unique_name_per_parent
  ON nodes (parent_id, lower(name)) NULLS NOT DISTINCT;

-- Exact search across all files, with stable pagination
CREATE INDEX nodes_file_name ON nodes (name, id) WHERE type = 'file';

-- Top-10 suggestions as the user types
CREATE INDEX nodes_file_prefix ON nodes ((lower(name) COLLATE "C"), id)
  WHERE type = 'file';
