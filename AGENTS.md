# HostList Local guidance

- This repository is the public, demonstration-only edition. Keep its names, comments, docs, configuration, and extension permissions limited to this product and its demo source.
- The browser extension may access only the configured demo website and `127.0.0.1:18765`.
- Keep persistence in `src/server`; route handlers in `src/app/api` delegate to `src/server/api.ts`.
- Keep API responses independent of the SQLite column layout. The demo store uses a compact set of synthetic fields.
- Never commit `.env`, `config.local.json`, `data/`, generated exports, or real user records.
- Run `npm test`, `npx tsc --noEmit --incremental false`, and `npm run build` when verifying changes.
