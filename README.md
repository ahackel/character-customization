# Character customization

An exploration of how to build customizable, stylized game characters with good animation, for mobile. The target is a pixel-art game in isometric view about a shipwreck survivor on an island.

- [`docs/research.md`](docs/research.md) compares six 2D and 3D approaches, recommends one, and covers how it carries over to pixel art.
- The rest of this repository is a web prototype of that approach: 3D characters assembled from modular parts on one shared skeleton, drawn as pixel art.
- [`docs/pixel-style-research.md`](docs/pixel-style-research.md) collects what makes small pixel-art characters appealing and how shipped games build layered ones.
- [`docs/plan.md`](docs/plan.md) is the plan that followed feedback on that prototype: a true 2D pixel-art character whose items are written by a language model. `lab/` holds its first experiments and their results.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed address. Tap the island to walk (or use WASD), use the action buttons, and press **Customize** to open the wardrobe. **Scene** switches between the pixel look and a smooth look for comparison.

```bash
npm run build
```

builds a static site into `dist/`.

## The 2D wardrobe

With the dev server running, open `/wardrobe/` to dress a pixel person: gender, skin, three builds, face options, hair, beard, hat, top, bottom, shoes and a held item, with colour swaps, five actions and four facings. A condition from neat to tattered is a value of the character and ages everything worn, and the hair, by rule (`lab/wear.ts`). Its items are the model-generated ones from `lab/generated/`, assembled by `lab/catalog.ts`. The text is in English and German (`wardrobe/i18n.ts`).

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
| `lab/tools/` | Scripts that write the format descriptions, sample the 3D clips and render preview sheets |

The format descriptions and generated items in `lab/generated/` belong to the first base body. Running `lab/tools/make-specs.mjs` rewrites the descriptions for the current body; items should then be generated again.

## What the prototype shows

| Feature | Where |
|---|---|
| One skeleton and one animation set drive every outfit combination | `src/character.ts`, `src/animator.ts` |
| Eight item slots; items load on demand, one small file each | `src/assets.ts` |
| Skinned items (body parts) and rigid items (hats, capes, hand props) merged into one mesh per character | `Character.rebuild` |
| Recolouring by palette channel (skin, hair, main, trim) with no extra textures or meshes | `src/materials.ts`, `Character.recolor` |
| Face features as texture layers projected onto any head, with blinking and expressions | `src/face.ts` |
| Cover masking: a hat automatically hides the hair under it | `Assets.coverMask` |
| Slot rules: a hood blocks hats, two-handed weapons block the left hand | `blocks` in the catalogue |
| Held items choose the animations: stance and attack clips follow the weapon type | `src/actor.ts` |
| Cartoon motion added in code: squash and stretch, lean, spring-driven cape and hat | `src/juice.ts` |
| Foot-slide-free locomotion: walk and run speeds are measured from the clips | `measureStride` in `src/animator.ts` |
| Fixed isometric camera (2:1), 1 to 10 characters with live frame statistics | `src/world.ts` |
| Island scene: sand, grass, tide line, palms, wreckage, campfire, obstacles | `src/island.ts` |

### Pixel look

The characters stay 3D. They are drawn small and enlarged, with sprite conventions applied so the result reads as pixel art:

| Technique | Where |
|---|---|
| Low-resolution render enlarged by a whole number, at one fixed density of 22 pixels per world unit | `src/pixel.ts` |
| One-pixel dark outline from depth differences, on characters and scenery alike | `src/pixel.ts` |
| Camera snapped to the pixel grid, with the remainder applied on enlarging, so scrolling is smooth and nothing shimmers | `World.update` |
| Flat colour per channel and a three-step light ramp, so each material has a few fixed tones | `src/materials.ts` |
| Characters snapped to the pixel grid, eight facings, poses held at 12 per second | `src/actor.ts`, `Character.update` |
| Faces drawn from hand-placed pixel patterns on a 24 by 24 grid | `drawPixelFace` in `src/face.ts` |
| The wardrobe shows the in-game sprite itself, enlarged, never a higher-detail version | `World.update` |

One item still works in every direction and every animation, which is the reason for keeping 3D under the pixels.

With 45 items the prototype allows about 500,000 distinct outfits before colours and faces.

Measured per character: about 4,000 to 5,000 triangles, 25 bones, and 2 draw calls in the pixel look (body, face) or 3 in the smooth look (plus outline).

## Asset pipeline

```bash
npm run assets:fetch
```

downloads the source characters into `assets-src/` (not committed).

```bash
npm run assets:build
```

rebuilds `public/assets/` (committed, so the app runs without the two steps above).

`tools/build-assets.mjs` turns five complete source characters into:

- `rig.glb`: the shared skeleton and 31 animation clips, no meshes. The source rig's 41 joints are reduced to the 23 that deform geometry or carry items.
- `items/*.glb`: one geometry-only file per item, all expressed against the same joint list.
- `atlas.png`: every source texture in one atlas, so a whole character uses one material.
- `catalog.json`: slot, label, attachment joint, colour channels, face anchor, grip type and blocking rules per item.

Colour channels are found automatically: the source textures are grids of colour swatches, and each swatch an item uses becomes a channel. Face anchors come from where the source heads had their modelled eyes, which the pipeline removes.

This is the step a production pipeline would run on each generated or hand-made item once it has been fitted to the base body.

## What the prototype does not answer

- **Castaway content.** The items are fantasy adventurers, not shipwreck survivors. Theme items (torn shirts, straw hats, spears, fishing rods) still have to be made or generated.
- **Hand-pixelled quality.** Rendered pixel art has no hand-placed pixel clusters. Whether it meets your bar for pixel art is a judgement to make by looking at it in motion.
- **Generated content.** All items here are hand-made (KayKit). Whether AI-generated items hold one consistent style is the main open risk in the research and is untested.
- **Performance on phones.** Frame statistics were only checked in a desktop browser with software rendering. Triangle, bone and draw-call counts are inside common mobile budgets, but nothing was measured on a device.
- **Skin-weight transfer.** The source items were already skinned. Automatic weighting of new garments is described in the research and not implemented.
- **Retargeting.** The animations were made for this rig, so no retargeting was needed.
- **Brows.** These heads model brows as geometry, so the face layer covers eyes, mouth and blush only.

## Credits

Characters, items and animations: [KayKit Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg, CC0. Licence text in `public/assets/KAYKIT-LICENSE.txt`.
