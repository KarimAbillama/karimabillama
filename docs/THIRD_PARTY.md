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

The offline demo zip also ships the official Node.js Windows runtime (`node.exe`, MIT licence,
from the `node-win-x64` npm package).

Check exact licences of transitive dependencies with `npx license-checker --summary` before
production. That tool is not bundled.

## Infrastructure

| Item | Licence | Recurring cost |
|---|---|---|
| PostgreSQL 16 | PostgreSQL Licence (permissive) | Free to self-host. A managed database is a monthly fee (depends on provider and region, see Q9). |
| Docker (local dev only) | Docker Desktop terms apply for larger companies | Check Docker Desktop licensing for EDGE's company size, or use an alternative such as Podman or a native Postgres install. |
| Hosting, HTTPS certificate, backups, email sending | — | **To be estimated after the hosting decision (Q9).** Nothing is assumed yet. |

No paid SaaS, AI service or external API is used by the application.
