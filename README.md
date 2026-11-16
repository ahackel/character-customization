# Pixel Art

Tools for a pixel-art game in isometric view about a shipwreck survivor on an island: stylized characters with good animation, plants, rocks and terrain, with the content written by a language model and drawn by rules. People only review and touch up.

The tools are published at [andreashackel.de/pixel-art](https://andreashackel.de/pixel-art/): a start page, the [wardrobe](https://andreashackel.de/pixel-art/wardrobe/), the [animal editor](https://andreashackel.de/pixel-art/animals/), the [object editor](https://andreashackel.de/pixel-art/objects/) ([`docs/animal-spec.md`](docs/animal-spec.md), [`docs/object-spec.md`](docs/object-spec.md), made for Animal Hospital), the [flora tool](https://andreashackel.de/pixel-art/flora/) and the [scene editor](https://andreashackel.de/pixel-art/scene/).

The repository started as an exploration of customizable characters, and the earlier work is still here:

- [`docs/research.md`](docs/research.md) compares six 2D and 3D approaches, recommends one, and covers how it carries over to pixel art.
- A 3D prototype of that approach (3D characters from modular parts, drawn as pixel art) was removed once the 2D puppet replaced it; it is in the git history before the scene editor.
- [`docs/pixel-style-research.md`](docs/pixel-style-research.md) collects what makes small pixel-art characters appealing and how shipped games build layered ones.
- [`docs/plan.md`](docs/plan.md) is the plan that followed feedback on that prototype: a true 2D pixel-art character whose items are written by a language model. `lab/` holds its first experiments and their results.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed address for the start page.

```bash
npm run build
```

builds every page, the lab included, into `dist/`.

```bash
npm run build:site
```

builds only the published site (start page, wardrobe, animal and object editors, flora, scene editor) into `dist-site/`.

## Publishing

`.github/workflows/pages.yml` builds the site and publishes it with GitHub Pages on every push to `main`. With the repository named `pixel-art`, it appears at `andreashackel.de/pixel-art/`. It needs one setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## The 2D wardrobe

With the dev server running, open `/wardrobe/` to dress a pixel person: gender, skin, three builds, face options, hair, beard, hat, top, bottom, shoes and a held item, with colour swaps, five actions and four facings. A condition from neat to tattered is a value of the character and ages everything worn, and the hair, by rule (`lab/wear.ts`). A mood drives the facial expression. **Saved characters** keeps named characters on this device (save, save as new, delete, export and import as JSON); the scene editor plays them. The character model and that list are in `lab/character.ts`. Its items are the model-generated ones from `lab/generated/`, assembled by `lab/catalog.ts`. The text is in English and German (`wardrobe/i18n.ts`).


## Island flora

Open `/flora/` for plants, rocks and driftwood in the same style: palms, grass, cacti, jungle plants, stones and washed-up wood. A language model describes each one as a few parts (`lab/generated/spec-plant.md`); `lab/flora.ts` grows them by rule, adds variants, sizes, wind, drying out and cactus spikes, and draws them in the characters' view and palette. The page shows them on the ground and on a generated island with a survivor, and lets you edit a recipe and watch it regrow.

The island's ground is a height map (`lab/terrain.ts`): one whole level per one-metre tile, level 0 at the water line. Surfaces, cliffs, foam, where one can walk and what grows where all follow from the heights.

`node lab/tools/bake.mjs` bakes everything into texture atlases with pivots and animations for a game engine. How to export and draw it efficiently is in `docs/export.md`.

## Scene editor and engine

Open `/scene/` to build a scene and walk around it. Spec: [`docs/engine-spec.md`](docs/engine-spec.md).

- **Edit**: raise and lower the ground (lowered below the water line it becomes sea floor), smooth it, level it to the height where a drag starts, paint sand, grass or rock over the height rule, place plants from the flora tool (with the recipes and colours edited there), remove plants, set the start point. Brushes of 1 to 3 tiles.
- **Play**: a saved character from the wardrobe walks (WASD or arrows, Shift to run) or goes where you tap; far taps run. E waves, F uses the held item. Water, cliffs of more than two levels and every plant but grass block the way. The camera stays put; pan it by hand.
- **View**: turn the scene by quarter turns (Q and R, or the arrows by the zoom buttons), zoom and pan, in both modes. Turning only changes the view; the saved scene keeps its own coordinates.
- **Scenes**: several per device, each with a name and a size of 8 to 64 tiles a side; new, settings (rename, resize), delete, export and import as JSON. Saved in this browser on every change.

The engine is three files in `engine/`, built on the lab code: `scene.ts` (the saved form, checks for anything read back, storage and files), `world.ts` (ground image, plant pictures, composing the camera window, picking tiles, collision) and `actor.ts` (movement, facing, clips and emotes). The page in `scene/` is the editor on top.

Known limit: every ground edit redraws the whole ground, about 70 ms for a 28 by 28 scene and 300 ms for 64 by 64 on a laptop, so large scenes stutter while sculpting.

## The 2D experiments

With the dev server running, open `/lab/` for the comparison page.

| File | Purpose |
|---|---|
| `lab/puppet.ts` | Draws a 32 by 48 character from joint positions by fixed pixel rules, in four facings |
| `lab/poses.ts` | Hand-written key poses, and poses built from sampled 3D clips |
| `lab/items.ts` | The two item formats, their checks, and conversion to one common item shape |
| `lab/base.ts`, `lab/palette.ts` | Generated base body, faces and hairstyles, and the master palette |
| `lab/catalog.ts` | Turns every generated file into wardrobe items and handles colour swaps |
| `lab/generated/` | Format descriptions given to the model, its unedited answers, sampled poses, the 3D reference sheet |
| `lab/tools/` | Scripts that write the format descriptions, sample the 3D clips and render preview sheets; `review.mjs` renders wardrobe characters in every facing and walking |

The format descriptions and generated items in `lab/generated/` belong to the first base body. Running `lab/tools/make-specs.mjs` rewrites the descriptions for the current body; items should then be generated again.

## Credits

The sampled poses and the 3D reference picture in `lab/generated/` come from the animations of [KayKit Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg, CC0.
