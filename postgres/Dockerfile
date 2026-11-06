FROM postgres:18

COPY db/ /opt/db/

# \i <file> is a psql command - runs the SQL in the file.
COPY <<'SQL' /docker-entrypoint-initdb.d/init.sql
\i /opt/db/1-db-and-users.sql
\i /opt/db/2-schema.sql
\i /opt/db/3-fixtures.sql
SQL

USER postgres
