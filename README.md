# Chris4F24

A browser file system: create folders and files, search files by exact name, get typeahead suggestions and delete nodes. Built with NestJS, Postgres and React.

I used Claude Code as a copilot. It helped me investigate things and write thorough tests, and I checked the generated code manually myself.

## Run with Docker

```bash
docker compose up --build -d
docker compose down -v # also deletes the volume
```

- Frontend: http://localhost:5173
- API: http://localhost:3001/api
- Postgres starts with sample data: 5 folders and 50 files.

## Run in debug mode

Requires Node 24+ and Docker. Postgres runs in Docker on port 5433, so it does not clash with a local Postgres on 5432. The API and frontend run on the host.

```bash
# Start Postgres
docker compose -f docker-compose.yml -f docker-compose.debug.yml up --build -d --wait postgres

# Start the API on port 3001, with the Node inspector on 9229
cd api
cp .env.example .env
npm ci
npm run start:debug

# In a second terminal, start the frontend on port 5173
cd frontend
npm ci
npm run dev
```

Attach a debugger to `localhost:9229`.

## Tests

Tests use a real Postgres 18 (Testcontainers) and the real schema. They connect as a least-privilege role with the same grants as the production role.

```bash
cd api
npm ci

# e2e tests need a running Docker daemon because they use Testcontainers

# Run unit and e2e tests together
npm run test

# Or just the e2e tests
npm run test:e2e

# Or just the unit tests
npm run test:unit
```

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/filesystem?parentId=&limit=&cursor=` | List one folder, or root when `parentId` is omitted |
| `POST` | `/api/filesystem/folders` | Create a folder: `{ "name": "docs", "parentId": null }` |
| `POST` | `/api/filesystem/files` | Create a file, same body |
| `DELETE` | `/api/filesystem/folders/:id` | Delete a folder and everything in it |
| `DELETE` | `/api/filesystem/files/:id` | Delete a file |
| `GET` | `/api/filesystem/search?name=&parentId=&limit=&cursor=` | Exact file name search |
| `GET` | `/api/filesystem/search/suggestions?prefix=&parentId=` | First 10 files starting with `prefix` |
| `GET` | `/api/health` | Health check, including the database |

For search and suggestions, omit `parentId` to search all files, or pass `root` or a folder id to search one level. `cursor` only applies when searching all files.

Names are unique per folder regardless of case, so `Report.txt` and `report.txt` cannot share a folder. Exact search is case-sensitive, suggestions are not.

Errors use `400` for validation, `404` for missing nodes, `409` for name conflicts, `413` for a body over 4 KB, `415` for a non-JSON or compressed body, `429` for rate limiting, `503` when the database is unavailable or a query times out, and `500` for anything unexpected. Error bodies look like `{ "error": { "code": "NAME_CONFLICT", "message": "..." } }`, and `429` responses include a `Retry-After` header.

Successful creates return `201` with the new node, and deletes return `204` with no body.

## Frontend

The brief needs no design, so the frontend is deliberately minimal: a simple UI to exercise the API. Almost everything is in `App.tsx`, using `useState` and `useEffect` rather than React context or `useReducer`.

The Docker image has two stages: one builds the source, the other serves the built files with Nginx.

## Backend

- I chose NestJS because of the job ad. I had not worked with it before, so I read through it and experimented a bit first. I have worked with other frameworks such as Express, Next.js and Remix.
- There is one feature module, `FileSystem`, covering both folders and files. With more time I would split it.
- I wrote parameterized SQL instead of using an ORM. The queries have to match the indexes exactly, such as `lower(name) COLLATE "C"`, so I wanted direct control over the SQL.
- Some hardcoded strings remain that I would extract to constants with more time.

Protection at the API boundary:

- Zod validates every request, and unknown fields are rejected.
- Request bodies are JSON only, limited to 4 KB, and compressed bodies are rejected.
- Rate limit of 300 requests per minute per IP address as seen by the API, excluding the health check. Under Docker Desktop all outside clients appear as one IP, so they share this limit. A real deployment needs a proxy that passes the real client IP.
- Helmet headers and a CORS allowlist.
- Environment variables are validated at startup, so bad config fails immediately.
- A 5 second statement timeout on database queries.
- Containers run as non-root users and have health checks.

## Database

- I chose Postgres. I considered SQLite because the task is small, but the assignment asks for _"Invariants enforced at the database level, not just via racy application-side checks"_. Postgres handles many concurrent writers, while SQLite allows one writer at a time, and I use Postgres features such as `NULLS NOT DISTINCT`.
- I first tried two tables, directories and files, with uniqueness per table. That allowed a file and a folder with the same name in one directory, which file explorers do not allow. So I created one `nodes` table with a custom type `node_type` (`file|folder`) and enforced `parent_type` to be `folder`, so nodes can only be created under a folder. If I needed content or other per-type columns, I would add separate tables linked by primary and foreign keys.
- I used cursor pagination instead of limit and offset, because `OFFSET` gets slower on deep pages and can skip or repeat rows during writes. It is covered by e2e tests, but the frontend does not use it yet.

## Schema decisions

The app user (`chris_user`) can only read, add and delete rows. The API never updates rows, so it does not get `UPDATE`, and it cannot change the schema or drop tables.

### Constraints

- `uuidv7()` primary key: time-ordered, so inserts stay cheap on the B-tree, unlike random UUIDs.
- `nodes_parent_is_folder` + `nodes_parent_fk`: every row says its parent is a `folder`, and the foreign key checks that this `(id, type)` pair exists. A file's pair is `(id, file)`, so it can never be a parent.
- `nodes_id_type_key`: makes `(id, type)` unique, because Postgres requires that for a foreign key target.
- `ON DELETE CASCADE`: one delete removes the whole subtree atomically and leaves no orphans. See the limit under [Known limits](#known-limits).
- `nodes_name_valid`: last line of defence for name rules if a write bypasses API validation. Rejects names that are exactly `.` or `..` (dots elsewhere are fine, e.g. `.env.example`), names containing `/`, `\` or control characters, untrimmed names and non-NFC (Normalization Form Canonical Composition) text. The API trims names and normalizes them to NFC, and rejects everything else with `400`. The database never changes a name.

### Indexes

- `nodes_unique_name_per_parent`: gives uniqueness per folder without check-then-insert races. `lower(name)` makes it case-insensitive, `NULLS NOT DISTINCT` covers root level, where `parent_id` is NULL. Also serves sorted folder listing and exact search within a folder.
- `nodes_file_name`: `(name, id)` serves global exact search, and `id` gives stable cursor paging over repeated names. Partial, because folders are never searched.
- `nodes_file_prefix`: `COLLATE "C"` lets `LIKE 'prefix%'` use the index under any database locale. Stored in the query's `ORDER BY` order, so Postgres reads the first 10 entries with no separate sort step. Partial (`WHERE type = 'file'`), because only files are suggested.

## Known limits

- **Deleting very large folders:** a delete runs as one transaction under the 5 second statement timeout. In a local test, deleting a folder with 300,000 files timed out and rolled back, so nothing was lost but the folder remained. At this scale I would delete in batches in a background job.
- **Frontend paging:** the frontend shows only the first 100 items of a folder and the first 50 results of a search across all files, because it does not use the cursor yet.

## Scaling further

Listing, exact search and suggestions all use indexes, and stayed fast in a local test with 400,000 rows. As load grows, I would:

- move large deletes to a background job
- add connection pooling such as PgBouncer
- send reads to replicas
- keep rate limit counters in a shared store such as Redis, because they are held in memory per instance today

## Considered but not set up

- No authentication. The brief does not ask for it.
- No CSRF protection. There is no auth or cookies, so there is no session to abuse.
- No HTTPS.
- No Postgres encryption.
- No caching.
- No migration tool. The schema is applied by init scripts when the database is first created.
- No rename or move, so the API has no `UPDATE`.
- No metrics or CI.
- The local database passwords are in the repo. A real deployment would use a secrets manager.
