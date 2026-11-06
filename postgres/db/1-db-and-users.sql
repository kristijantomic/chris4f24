DROP DATABASE IF EXISTS filesystem WITH (FORCE);

DROP USER IF EXISTS chris_user;

CREATE USER chris_user WITH PASSWORD 'secret_pass2';

CREATE DATABASE filesystem
    WITH OWNER = postgres
    ENCODING = 'UTF8'
    CONNECTION LIMIT = -1;

REVOKE ALL ON DATABASE filesystem FROM PUBLIC;
GRANT CONNECT ON DATABASE filesystem TO chris_user;

-- Before grant privileges to chris_user
-- connect to the filesystem database
\connect filesystem

GRANT USAGE ON SCHEMA public TO chris_user;

-- Allow chris_user access to existing tables and sequences
GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO chris_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chris_user;

-- Allow chris_user access to future tables
-- and sequences created by postgres
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, DELETE ON TABLES TO chris_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO chris_user;