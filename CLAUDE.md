# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install`, then `npm run dev` — Vite dev server (start page at `/`, tools at `/wardrobe/`, `/animals/`, `/objects/`, `/flora/`, `/scene/`, and the experiment page `/lab/`).
- `npm run build` — `tsc --noEmit && vite build` of every page including `/lab/` into `dist/`. The type check is the only static check; there is no linter and no test runner.
- `npm run build:site` — same, but only the published pages (no lab) into `dist-site/`. `.github/workflows/pages.yml` runs this on push to `main`.
- `npm run bake` (`lab/tools/bake.mjs`) — bakes characters and flora into texture atlases with pivots and animations for a game engine (see `docs/export.md`).
- `npm run check:turntable` — measures hairstyles, hats and garments across the five drawn views and reports where they disagree.
- Other checks are plain scripts in `lab/tools/*.mjs` (e.g. `parts-check.mjs`, `animals-check.mjs`, `objects-check.mjs`, `check-all.mjs`, `review.mjs`); run them with `node lab/tools/<name>.mjs`. They use `pngjs` to render sheets.

## Architecture

A pixel-art toolkit for an isometric shipwreck-survivor game. Content (clothes, hair, plants) is written as JSON by a language model against format specs; code draws it by fixed pixel rules. Everything is rendered procedurally to canvas; there is no framework.

- `lab/` is the core library despite its name, and the pages import from it. Key pieces: `puppet.ts` (draws a 32x48 character from joint positions, four facings), `poses.ts` (key poses and poses sampled from 3D clips), `items.ts` (the two item formats, validation, conversion to a common shape), `base.ts` + `palette.ts` (body, faces, hairstyles, master palette), `shell.ts` (hair as one shape around the skull, drives all views), `wear.ts` (condition/aging rules), `catalog.ts` (assembles wardrobe items from `lab/generated/` and handles colour swaps), `character.ts` (character model and the saved-characters list), `flora.ts` / `flora-catalog.ts` (plants grown by rule from model-written part recipes), `terrain.ts` (height map: one whole level per metre tile, level 0 at the waterline; surfaces, cliffs, foam, walkability and plant placement all derive from heights), `animal.ts` and `object.ts` (animal and object editors' renderers; specs in `docs/animal-spec.md`, `docs/object-spec.md`).
- `lab/generated/` holds the format descriptions given to the model (`spec-*.md`, rewritten by `lab/tools/make-specs.mjs` for the current body), the model's unedited JSON answers (`recipe-*`, `sprite-*`, `plant-*`), sampled poses and reference sheets. These belong to the current base body; if the body changes, items must be regenerated. `lab/face-shapes.json` is written by a dev-server-only endpoint in `vite.config.ts` (the wardrobe's shape editor); it can't save on the published site.
- `engine/` is the game runtime built on `lab/`: `scene.ts` (saved scene format, validation of anything read back, storage, files), `world.ts` (ground image, plant pictures, camera window composition, tile picking, collision), `actor.ts` (movement, facing, clips, emotes), plus `herd.ts`, `ocean.ts`, `decor.ts`, `items.ts`. Spec and decisions: `docs/engine-spec.md`.
- Page folders (`wardrobe/`, `animals/`, `objects/`, `flora/`, `scene/`, `home/`) each have an `index.html` + `main.ts` (and often `i18n.ts`, `style.css`) and sit on top of `lab/` and `engine/`. `shared/` holds UI helpers used across pages (`history.ts` undo, `brush.ts`, `pixels.ts`, `lang.ts`, `base.css`, `ui.css`).
- Pages are multi-page Vite entries listed in `vite.config.ts`; a new page must be added to `pages` there (and linked from the start page). Config uses `base: './'` so the build works from any path.

## Conventions

- UI text is English and German via per-page `i18n.ts`; add both when adding strings.
- User data (saved characters, scenes) lives in browser storage on the device and is exported/imported as JSON; anything read back must be validated (see `engine/scene.ts`).
- `docs/` holds the specs and the research history (`docs/plan.md`, `research.md`); the older 3D prototype was removed and lives only in git history.
