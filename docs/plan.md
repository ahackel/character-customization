# Plan: 2D pixel-art survivors

Date: 14 November 2026. Follows the 3D prototype and the feedback on it.

## Feedback and what it changes

| Feedback | Consequence |
|---|---|
| The bought 3D characters look good but every new item would have to be modelled or bought | Stop treating 3D items as the content format |
| Reference image: small hand-pixelled people, no outlines, flat colours | The target style is true 2D pixel art, not a filtered render |
| A low-resolution 3D render is not convincing pixel art: shapes are accidental, outlines and shading do not fit | Pixels must be placed by rules or by an author, never by a rasteriser |
| Content has to be generated quickly and automatically | The item format must be something a language model can write reliably |

## Target, from the interview

| Topic | Decision |
|---|---|
| Sprite size | About 32 by 48 pixels |
| Facings | Four diagonals: two drawn, two mirrored |
| Animation | Classic: 4 to 6 frame walk, 3 or 4 frames per action |
| Style | Like the reference: no outline, flat colour with one shade, large head, simple face |
| Workflow | Generate, then curate: several candidates per request, a person picks and may fix pixels |
| Generation tools | A language model only. No image-generation services |
| Hand-made art | None from scratch. People review and touch up, including the base body |
| Customizable | Clothing and its condition; hair, beard and skin; tools and carried items. No body builds |
| Game needs | Design your survivor; looks change during play; generated other survivors |
| Curation tool | Candidates shown on the animated character in all four facings; regenerate with a note; pixel touch-up |
| 3D prototype | Kept for comparison and as a helper for producing assets |

## The core problem

An item must look right in every frame of every animation, in every facing. With about 40 frames and two drawn facings, that is about 80 images per item. A language model drawing 80 images per item would be slow and inconsistent, and nobody is available to draw them by hand.

So an item has to be **defined once and multiplied by the system**. The 3D prototype had this property. The plan keeps the property and drops the 3D look.

## Proposed architecture: a pixel puppet

**Poses are data, drawing is rules.**

- A pose is a small set of joint positions (head, shoulders, elbows, hands, hips, knees, feet) in the character's own 3D space, in pixel units.
- A renderer projects the joints for the wanted facing and draws the body with fixed pixel-art rules: limbs as clean pixel columns, the torso as a simple block, far-side limbs in the shade tone, no outline.
- Because poses are 3D, all four facings come from one pose. Eight would also work later.

**The head is a rigid stamp.** It only moves by whole pixels, so everything on it is a small fixed pixel image per drawn facing: face, hair, beard, hat. This is where deliberate pixel placement matters most, and where it is cheapest: two small images per item.

**Clothing is paint on the standing pose.** A top or bottom is defined by how it colours the body in the standing pose, front and back. The renderer knows which body part and which position along it every pixel belongs to, in every frame, so it carries the paint to all frames.

**Tools and carried items are rigid stamps** attached to a hand or the back.

**One master palette.** Every colour is a palette entry with a paired shade. This is the strongest tool for making generated items look like one set, and it gives recolouring and fading for free.

What this gives each game need:

| Need | How |
|---|---|
| Design your survivor | Same slot-and-colour editor as the 3D prototype, drawing the puppet instead |
| Looks change during play | Wear is a parameter: ragged hems, holes and fading are applied by rule to any garment. Beard growth is a generated series of stamps. Crafted gear is ordinary items |
| Generated other survivors | Random valid combinations, as in the prototype |

## Generation pipeline

1. **Request.** A short description, for example "torn striped shirt".
2. **Generate.** The language model returns several candidates as text in the item format.
3. **Check automatically.** Format valid, palette entries only, paint stays on allowed body parts, stamp within size limits. Invalid candidates are dropped or sent back with the error.
4. **Preview.** Each candidate is drawn on the animated character in four facings.
5. **Curate.** A person picks one, optionally asks for a change in words, optionally fixes pixels.
6. **Catalogue.** The accepted item is stored as data. No image files are needed.

## What the 3D prototype is still for

- **Comparison.** The same character at the same size, rendered from 3D without outlines, shown next to the puppet.
- **Motion source.** Its 31 animation clips can be sampled at key moments and turned into puppet poses, instead of authoring every pose by hand. Whether that looks right at this size is one of the experiments.

## Experiments

Three small tests on the same handful of items, so the choice rests on results. Items: torn striped shirt, ragged shorts, straw hat, long hair with beard, fishing spear.

| Test | Question | Compared |
|---|---|---|
| 1. Foundation | Does a rule-drawn puppet read as real pixel art where the 3D render did not? | Puppet against the 3D render at the same size, both without outlines, walking in four facings |
| 2. Motion source | Can the 3D clips feed the puppet? | Walk cycle authored as key poses against a walk cycle sampled from the 3D clip |
| 3. Item generation | Which item format does a language model write well? | Whole-sprite pixel grids against structured recipes with small stamps. Three candidates per item per format, from fresh model calls, shown unedited |

For test 3 the model calls are made from this session as stand-ins for an automated pipeline. Each call gets only the format description and the request, as an automated call would.

Results go into a comparison page and into the last section of this document.

## Decisions still open

1. **Where the model runs in production.** A curation tool that regenerates on request needs live model access: an API key and a small server, or a hosted alternative. Not needed for the experiments.
2. **Palette.** Size and colours of the master palette. I will start with about 32 colours suited to an island: sand, sea, foliage, wood, cloth, skin tones.
3. **Engine.** Still open. The puppet is plain 2D drawing and ports to any engine; the catalogue is data.
4. **Sprite cache.** At runtime the puppet can draw each frame on demand or bake a sprite sheet per character when its look changes. Baking is the likely answer for mobile.

## After the experiments

1. You pick the item format and the motion source from the results.
2. Build the curation tool around that format: candidates on the character, regenerate with a note, pixel touch-up.
3. Generate a first real catalogue of about 30 castaway items and judge consistency.
4. Rebuild the wardrobe and the island scene on the puppet.
