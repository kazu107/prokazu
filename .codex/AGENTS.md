# Repository Guidelines

## Project Structure & Module Organization
The Node entrypoint lives in `server.js`, serving `index.html`, `battle.html`, and other static assets directly from the repository root. Shared problem definitions and helper utilities are maintained in `scripts/problems.js` and consumed on both the server and client (`scripts/main.js`, `scripts/battle.js`). Front-end styling is consolidated in `styles/main.css`, and images should live under `image/`. Keep environment-specific secrets out of version control; if you add new configuration keys, update this guide and include a scrubbed `.env.sample`.

## Environment & Configuration
Duplicate `.env` locally with the keys required by `server.js`: `PORT`, `HOST`, `DATABASE_URL`, and optional SSL flags (`DATABASE_SSL`, `PGSSLMODE`). When adding new secrets, reference them through `process.env` and provide fallbacks so Heroku-style deployments using `Procfile` continue to work. Avoid hard-coding connection strings in client bundles; route all persistence through the backend pool.

## Build, Test, and Development Commands
Run `npm install` once to sync Node dependencies. Use `npm run start` (alias for `node server.js`) for local development; the server automatically serves files under the project root, so reload the browser to pick up changes. When working with PostgreSQL-backed features, export a `DATABASE_URL` before starting the server. Replace the placeholder `npm test` script once automated tests exist.

## Coding Style & Naming Conventions
Use modern JavaScript with `const`/`let`, 4-space indentation, and trailing commas for multi-line literals. Keep constants in `UPPER_SNAKE_CASE` (see `MIME_TYPES`) and functions or variables in `camelCase`. Mirror the existing module structure (`scripts/<feature>.js`) and avoid introducing global variables on the client; attach shared data to `window` only when required by the UI.

## Testing Guidelines
Automated coverage is currently absent; prefer `node --test` or Jest with files placed under `scripts/__tests__/` or `tests/`. Replace the placeholder `npm test` command with the chosen runner and ensure it exits non-zero on failure. Add fixtures for problem definitions so both server rendering and client grouping logic are exercised. Document any manual regression steps for features such as battle mode and board submissions until automated coverage is in place.

## Commit & Pull Request Guidelines
History favors short imperative summaries (often in Japanese, e.g., "dotenv修正"). Continue using concise subject lines and include context in the body when changes are complex. For pull requests, link the relevant issue or Trello card, outline testing performed (commands and datasets), and attach browser screenshots for UI updates. Confirm database migrations or seed scripts before requesting review and ensure lints/tests pass locally.
