# HostList Local

HostList Local is a local-first host directory with deterministic and AI-assisted profile analysis. It stores data in SQLite on this computer. The public edition is designed for a demonstration data source.

## Start the local app

1. Install Node.js 22.18 or newer.
2. Run `npm install` and then `npm run dev` from this directory.
3. Open `http://127.0.0.1:18765`.
4. To enable AI analysis, copy `.env.example` to `.env`, add an API key, and restart the app. The key is used only by the local server.

The public demo pages and synthetic host data are provided by the separate HostList Server project. Open the directory there, then use its pagination and host detail pages; the Firefox extension captures their JSON responses into this app's local SQLite database.

## What the analyses evaluate

The public demo does not load or send a candidate CV, personal profile, or private host data during analysis. Its fixed rubric reflects the intended candidate archetype behind the project: someone interested in software development, applied AI/data, mentoring, relevant technology, practical learning and contribution, and professional networking. Those interests shape what the rubric rewards, but the app does not read a person's CV or compare an individual candidate's skills with an individual host. The result is a consistent assessment against that assumed technical profile, not a personalized match score.

The deterministic method is an explainable, rule-based baseline. It looks for relevant signals in the host's professional text and combines them with a few indicators such as experience, team size, and whether key descriptions are present. The same saved host data always produces the same result; no model or network call is involved. Scores indicate how much evidence the profile contains for each rubric area, not the host's overall quality or suitability for a particular person. Confidence is reduced when important descriptions are missing. This heuristic has not been validated as a recruitment or placement decision tool and should be treated as an exploratory aid.

AI analysis uses the same intended technical candidate archetype, expressed in its prompt as a software developer seeking a practical learning and collaboration opportunity. The model receives only selected professional host fields; candidate names, IDs, contact details, location, and CV are not included. This framing would not suit someone seeking, for example, a marketing placement without adapting the prompt and rubric. To compare against a different candidate's actual skills and goals, the app would also need a candidate-profile input; none can currently be entered or selected.

This is a focused proof of concept, not a ready-made matching system for every profession. Its browser-based data capture, local storage, review workflow, and analysis pipeline can provide a starting point for other domains, but adapting it requires a suitable data source and schema, a candidate profile, and criteria designed for that field. For example, a hospitality version would need different host information and a rubric for hotel or restaurant roles. The project demonstrates an end-to-end technical implementation around a clearly scoped use case; it does not claim that the current scoring works unchanged outside that scope.

## Local data and privacy

- SQLite database: `data/hostlist.sqlite3` (ignored by Git).
- Environment files and local configuration overrides are ignored by Git.
- The app server binds to `127.0.0.1:18765`.
- Analysis requests are sent to the configured model provider only after an explicit user action.

## Checks

- `npm test` runs the isolated API-client tests.
- `npx tsc --noEmit --incremental false` checks TypeScript types.
- `npm run build` creates the production build.
