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

Three small tests on the same handful of items, so the choice rests on results. Items: torn striped shirt, ragged shorts, straw hat, castaway beard, fishing spear.

| Test | Question | Compared |
|---|---|---|
| 1. Foundation | Does a rule-drawn puppet read as real pixel art where the 3D render did not? | Puppet against the 3D render at the same size, both without outlines, walking in four facings |
| 2. Motion source | Can the 3D clips feed the puppet? | Walk cycle authored as key poses against a walk cycle sampled from the 3D clip |
| 3. Item generation | Which item format does a language model write well? | Whole-sprite pixel grids against structured recipes with small stamps. Three candidates per item per format, from fresh model calls, shown unedited |

For test 3 the model calls are made from this session as stand-ins for an automated pipeline. Each call gets only the format description and the request, as an automated call would.

Results are in the last section of this document and on the comparison page built from `lab/`.

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

## Experiment results

Run on 14 November 2026. Code and all generated data are in `lab/`. To view the comparison page, run `npm run dev` and open `/lab/`.

The observations below are mine, from looking at rendered frames. The page shows everything unedited so you can form your own view.

### 1. Foundation

A 32 by 48 puppet drawn by rules walks in four facings and wears generated items. Next to it, the 3D prototype rendered at the same size without outlines.

- The puppet has straight limb edges, even patterns and a face made of chosen pixels. The 3D render has uneven edges and stray pixels, and its silhouette shifts between frames.
- The puppet is stiffer: a rigid torso block and limbs without volume.
- The base body, face and short hair were written by the model and corrected by looking at renders. The first version was judged too plain; see the next section.

### Base body, second version

Feedback on the first body: too plain and generic, one arm looked off, and the spear was not held. It was rebuilt on 15 November 2026 after researching the style ([pixel-style-research.md](pixel-style-research.md)).

- **Arm.** True isometry put one shoulder two pixels above the other, so the far arm hung from the neck. Sideways offsets inside the body are now flattened, as hand-drawn sprites do.
- **Grip.** A pole stands on the ground beside the body, the arm reaches out to it, and the fist is drawn over the shaft, front and back.
- **Face and hair.** Taller eyes with a shine, blush, an open smile, a blink and a laughing face. Hair in clumps with a tuft and a lit band.
- **Body.** Hands and feet as visible blocks, legs with a gap, a shaded edge where the arm crosses the body, shadows under the chin and on the ground.
- **Colour.** One rule derives every shadow (towards plum) and highlight (towards cream).
- **Motion.** A breathing idle, a lean in the walk, and the hat arriving one frame late.
- **Facings.** The two left facings are now exact mirror images of the right ones, as in Stardew Valley.

Still plain: the torso is a block, the back view has little to look at, and there is one body and one hairstyle. The generated items were drawn against the first body and are shown on the second unchanged.

### 2. Motion source

- Sampling the 3D clips works. Only bone directions are taken, so the source character's proportions do not matter. All 31 clips are available this way; idle, walk, run, wave and chop were tried.
- Sampled motion carries the source's posture (arms held away from the body, bent knees). It suits actions; the hand-written walk is tidier.
- A pole stays planted beside the body in every action. Tools that swing still need rotated variants.

### 3. Item generation

Ten fresh model calls, three candidates each, given only the format description and the request.

| Format | Valid as returned | Rejected | Time per call |
|---|---|---|---|
| Whole-sprite paint | 15 of 15 | 0 | 82 to 116 s |
| Recipes and stamps | 15 of 15 | 0 | 5 to 6 s for clothing, 116 to 195 s for stamps |

Times include the overhead of running each call as a helper inside the working session, so they are relative, not absolute.

- Clothing recipes are fastest and cannot come out misshapen, but express only what their settings allow.
- Whole-sprite paint is freer. It produced a patch and a contrasting frayed hem the recipes had no setting for.
- For tools, whole-sprite paint was clearly better: straight shafts with readable tips. Stamp versions leaned and broke into jagged lines.
- Both formats drew beards wrongly in back views, as a tuft at the neck.
- Recipe shorts came out very short because of the length scale in my format description.
- Two frame-size limits in my own code clipped whole-sprite hats and spears on the first pass. I fixed the code; nothing was regenerated.

### Third pass and the wardrobe prototype

Requested on 15 November 2026: push the body further, add a second hairstyle and a second build, keep the hat attached to the head, and provide a prototype for testing customization.

- **Hat.** The one-frame delay on hats is removed. A hat is rigid on the head.
- **Second build.** A sturdy build with an 11-pixel torso and wider legs. Clothing drawn for the slim build is fitted by repeating one column on each side of the middle, so no item needs a second drawing.
- **Second hairstyle.** Long hair with a lock in front of the ear, a mass behind the neck in front views and a fall over the upper back from behind.
- **Body.** A shadow under the fringe or hat brim, a lit shoulder corner, a hint of the spine on the bare back.
- **More items.** Nine further model calls produced 33 candidates (tops, bottoms, shoes, bandanas, caps, vests, leaf skirts, axes, fishing rods). All 33 were valid as returned. Tops, bottoms, bandanas, caps and vests look good to me; the axes are small and unclear and the fishing rods are thin and lean.
- **Wardrobe.** `wardrobe/` is a page for dressing the survivor: skin, build, hairstyle and colour, beard, hat, top, bottom, shoes and tool, with colour swaps per item, five actions, four facings and four ground colours. It holds 57 items: everything generated so far except the two sets excluded for known faults (the leaning small-stamp spears and the first, too-short recipe shorts).

Two rules are applied on top of the generated data: beards are hidden from behind, and a beard takes the hair colour.

### Fourth pass

Requested on 15 November 2026.

- **Tools in the hand.** A tool's grip is pinned to the hand in every frame; nothing stands on the ground any more. A long tool is carried with the arm held out so the shaft clears the head.
- **Rotating tools.** In swinging actions the tool turns with the forearm in steps of 45 degrees, as if held like a hammer. Long tools only tilt by one step so they stay on the canvas. Rotation is computed from the one drawing of the tool.
- **Tucked hair.** Under a hat that covers the crown, hair above the hat's lower edge is removed by rule, so nothing pokes through or bulges beside it. A band such as a headband leaves the hair alone.
- **Canvas.** Sprites are now drawn on a 64 by 64 canvas with the 32 by 48 body in the middle, which gives swung tools and wide hats room. The whole-sprite format still paints on 32 by 48.
- **Third build.** Very slim: a 7-pixel torso, 2-pixel arms and 3-pixel legs. Clothing is fitted by dropping one column on each side.
- **Gender.** A feminine body shape narrows the waist on the far side and adds a chest shadow; clothing follows both by rule. It also turns on eyelashes by default.
- **Faces.** Composed from options: four eye shapes, seven eye colours, three mouths, three brow weights, and blush, freckles, lashes and glasses.
- **Everyday clothes.** Eight further model calls produced 30 items for passengers and crew before the wreck: suit, officer's and cook's jackets, sailor shirt, hoodie, blouse, three dresses, jeans, suit trousers, pleated skirt, polo, jumper, shoes, sailor cap, cook's hat, sun hat, suitcase, umbrella, lantern, and three hairstyles (bun, afro, bob). 29 were valid as returned and one was auto-repaired (a hood reached past the torso area).
- **Wardrobe.** Option cards now show only the item, cut out of the sprite. There is a Face tab, a gender switch, three builds, generated hairstyles, and a filter between castaway items and items from before the wreck. It holds 87 items.

A fault found and fixed on the way: mirrored facings were one pixel off-centre.

### Recommendation

1. Build on the puppet.
2. Use both formats by item type: recipes for plain clothing and wear states, whole-sprite paint for anything with a distinctive shape. Both compile to the same item data.
3. Write the everyday poses (idle, walk) by hand and sample the rest from the 3D clips.
4. Expect curation. By my count about 18 of the 30 candidates are usable as returned. The six beards need their back view fixed, and the recipe shorts and stamp spears need a retry.

### Not tested

- Consistency across a large catalogue. Fifteen candidates per format is a small sample.
- Regenerating with a note, pixel touch-up, wear over time, beard growth.
- Hair falling behind the shoulders, skirts, backpacks, rotating tools.
