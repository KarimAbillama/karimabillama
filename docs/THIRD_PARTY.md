# Third-party software, licences and running costs

## Runtime dependencies (all open source, no licence fees)

| Package | Purpose | Licence |
|---|---|---|
| fastify, @fastify/cookie, @fastify/rate-limit, @fastify/static | HTTP server and plugins | MIT |
| drizzle-orm | Database access | Apache-2.0 |
| pg | PostgreSQL driver | MIT |
| zod | Input validation | MIT |
| decimal.js | Exact decimal arithmetic | MIT |
| @node-rs/argon2 | Password hashing | MIT |
| react, react-dom, react-router-dom | Web UI | MIT |
| tsx | Runs TypeScript on the server | MIT |
| @electric-sql/pglite | Embedded PostgreSQL for the offline demo and server-less tests | Apache-2.0 / PostgreSQL Licence |

## Development and test tools

| Package | Licence |
|---|---|
| typescript | Apache-2.0 |
| vite, @vitejs/plugin-react, vitest | MIT |
| drizzle-kit | MIT |
| playwright | Apache-2.0 |
| concurrently | MIT |
| esbuild (bundles the offline demo) | MIT |

The Windows Server package ships Node.js (`node.exe`, MIT) and WinSW 1.17 (`winsw.exe`, MIT, from the
`node-windows` npm package) to run EDGE SCM as a Windows service. PostgreSQL 16 is installed separately
from postgresql.org (PostgreSQL Licence, free).

The offline demo zip also ships the official Node.js Windows runtime (`node.exe`, MIT licence,
from the `node-win-x64` npm package).

Check exact licences of transitive dependencies with `npx license-checker --summary` before
production. That tool is not bundled.

## Infrastructure

| Item | Licence | Recurring cost |
|---|---|---|
| PostgreSQL 16 | PostgreSQL Licence (permissive) | Free to self-host. A managed database is a monthly fee (depends on provider and region, see Q9). |
| Docker (local dev only) | Docker Desktop terms apply for larger companies | Check Docker Desktop licensing for EDGE's company size, or use an alternative such as Podman or a native Postgres install. |
| Hosting | — | EDGE's own Windows Server (existing). No cloud fees. |
| HTTPS certificate | — | From EDGE's IT/domain provider; a self-signed one works for testing. |

No paid SaaS, AI service or external API is used by the application.
