# AGENTS.md

Read this first. It is the entry point for any AI agent working on this repo (Cursor, Claude, Codex, or anything else). `CLAUDE.md` points here.

## What this is

`socialengine-website` is the Social Engine portal and marketing site (`portal.html` and its scripts). It is deployed on Netlify from `main`. The API it talks to lives in the private `socialengine-api` repo.

**This repo is public.** Never commit secrets, client data, internal URLs, or private notes here.

## Where the context lives

All Social Engine project context lives in the private `socialengine-api` repo:

- `AGENTS.md`: the full rules for agents.
- `docs/context/STATE.md`: the current state of the product. Read it before starting work.
- `docs/context/README.md`: an index of every doc.

If that repo is checked out next to this one, the paths are `../socialengine-api/AGENTS.md` and `../socialengine-api/docs/context/`.

Feature specs and plans that are only about the portal can stay in this repo's `docs/superpowers/`. Add a line for each one to the API repo's `docs/context/README.md` so it can be found.

## The recording rule

When you change the portal, record it in the API repo before the work counts as done: update `docs/context/STATE.md` and add a dated note under `docs/context/notes/<area>/`. Production is `main` on GitHub; a local checkout can be far behind, so check `git fetch && git log origin/main` before trusting what is on disk.
