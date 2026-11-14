# Character customization

An exploration of how to build customizable, stylized game characters with good animation, for mobile.

- [`docs/research.md`](docs/research.md) compares six 2D and 3D approaches and recommends one.
- The rest of this repository is a web prototype of the recommended approach: real-time 3D characters assembled from modular parts on one shared skeleton.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed address. Tap the ground to walk (or use WASD), use the action buttons, and press **Customize** to open the wardrobe.

```bash
npm run build
```

builds a static site into `dist/`.

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
| Toon shading with coloured outlines, fixed 3/4 camera, 1 to 10 characters with live frame statistics | `src/materials.ts`, `src/world.ts` |

With 45 items the prototype allows about 500,000 distinct outfits before colours and faces.

Measured per character: about 5,000 triangles, 25 bones, 3 draw calls (body, outline, face).

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

- **Generated content.** All items here are hand-made (KayKit). Whether AI-generated items hold one consistent style is the main open risk in the research and is untested.
- **Performance on phones.** Frame statistics were only checked in a desktop browser with software rendering. Triangle, bone and draw-call counts are inside common mobile budgets, but nothing was measured on a device.
- **Skin-weight transfer.** The source items were already skinned. Automatic weighting of new garments is described in the research and not implemented.
- **Retargeting.** The animations were made for this rig, so no retargeting was needed.
- **Brows.** These heads model brows as geometry, so the face layer covers eyes, mouth and blush only.

## Credits

Characters, items and animations: [KayKit Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg, CC0. Licence text in `public/assets/KAYKIT-LICENSE.txt`.
