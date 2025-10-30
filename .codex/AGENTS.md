# Repository Guidelines

## Project Structure & Module Organization
- `index.html` hosts the single-page experience: markup, global styles, and the inline script that drives problem navigation, attempt tracking, and persistence.
- Group UI helpers (DOM selectors, storage utilities, formatting) near the bottom script block; when logic grows, extract modules into `src/` and load them with `<script type="module" src="...">`.
- Place future assets under `assets/` (images, icons) or `data/` (JSON problem sets) so static hosting stays trivial and relative paths remain predictable.

## Build, Test, and Development Commands
- `npm install` prepares the workspace whenever new tooling (linters, bundlers, test runners) is introduced; the minimal `package.json` keeps lockfiles consistent across agents.
- `npx http-server .`—or WebStorm’s Live Edit—serves the site from the repo root so you can iterate on query-parameter flows like `?id=prime-sums`.
- `npm test` is currently a placeholder; wire it to your chosen runner before merging work that relies on automated verification.

## Coding Style & Naming Conventions
- Use 4-space indentation for HTML/CSS/JS blocks and keep line length near 110 characters to preserve readability for bilingual copy.
- Name DOM handles and helpers in lowerCamelCase (`problemList`, `buildProblemList`); reserve SCREAMING_SNAKE_CASE for constants such as `PROBLEMS`.
- Maintain paired Japanese/English strings (for example, `選択中 / Selected`) and update both halves in tandem.

## Testing Guidelines
- For logic extracted from `index.html`, add unit specs under `tests/` with the suffix `.spec.js` and register them under `npm test`.
- Perform manual smoke checks on the attempt counter, localStorage resets, and share-link copy whenever the submission flow changes.
- Capture at least one screenshot or short clip of the solved-state banner when altering UI styling so reviewers can validate regressions quickly.

## Commit & Pull Request Guidelines
- No git history exists yet; adopt Conventional Commits (`feat: add fibonacci puzzle`, `fix: handle zero attempts`) to keep future logs searchable.
- Pull requests should include a concise summary, test evidence (commands or screenshots), and call out any new query parameters or localStorage keys that downstream hosting must allow.
