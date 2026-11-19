# HostList Local

HostList Local is a local-first host directory with deterministic and AI-assisted profile analysis. It stores data in SQLite on this computer. The public edition is designed for a demonstration data source.

## Start the local app

1. Install Node.js 22.18 or newer.
2. Run `npm install` and then `npm run dev` from this directory.
3. Open `http://127.0.0.1:18765`.
4. To enable AI analysis, copy `.env.example` to `.env`, add an API key, and restart the app. The key is used only by the local server.

The demo pages and their sample data are provided by the separate HostList Server project and will be documented when that project is available. Until then, the dashboard and local API can be used with synthetic test fixtures.

## Local data and privacy

- SQLite database: `data/hostlist.sqlite3` (ignored by Git).
- Environment files and local configuration overrides are ignored by Git.
- The app server binds to `127.0.0.1:18765`.
- Analysis requests are sent to the configured model provider only after an explicit user action.

## Checks

- `npm test` runs the isolated API-client tests.
- `npx tsc --noEmit --incremental false` checks TypeScript types.
- `npm run build` creates the production build.
