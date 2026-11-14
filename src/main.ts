import * as THREE from 'three';
import './style.css';
import { Assets, type SlotId } from './assets';
import { Actor, separate, Wanderer } from './actor';
import { Character, type Look } from './character';
import { createCharacterMaterials } from './materials';
import { defaultLook, randomLook, sanitizeLook } from './looks';
import { Thumbnails } from './thumbnails';
import { Ui, type Gait } from './ui';
import { World } from './world';

const STORAGE_KEY = 'hero-wardrobe-look';
const root = document.getElementById('app')!;

function loadSavedLook(assets: Assets): Look | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeLook(assets, JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // Storage can be unavailable (private windows, embedded previews). The app works without it.
  }
}

async function start(): Promise<void> {
  const assets = await Assets.load();
  const materials = createCharacterMaterials(assets.atlas);

  let world!: World;
  let thumbnails!: Thumbnails;
  const settings = { outline: true, juice: true, shadows: true };
  let mode: 'play' | 'dress' = 'play';
  let gait: Gait = 'stand';
  let turntable = 0;

  const spawn = (look: Look): Actor => {
    const character = new Character(assets, materials, look);
    character.outlineVisible = settings.outline;
    character.juice.enabled = settings.juice;
    character.springsEnabled = settings.juice;
    return new Actor(character);
  };

  const player = spawn(loadSavedLook(assets) ?? defaultLook());
  const crowd: { actor: Actor; brain: Wanderer }[] = [];
  const everyone = () => [player, ...crowd.map((c) => c.actor)];

  const rebuildPlayer = async () => {
    await player.character.rebuild();
    player.refreshStance();
    saveLook(player.character.look);
  };

  const setCrowd = (total: number) => {
    const wanted = Math.max(0, total - 1);
    while (crowd.length > wanted) crowd.pop()!.actor.character.dispose();
    while (crowd.length < wanted) {
      const actor = spawn(randomLook(assets));
      const angle = Math.random() * Math.PI * 2;
      const radius = 3 + Math.random() * 4.5;
      actor.place(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.random() * Math.PI * 2);
      crowd.push({ actor, brain: new Wanderer(actor, 8) });
      void actor.character.rebuild().then(() => {
        actor.refreshStance();
        actor.character.root.visible = mode === 'play';
        world.scene.add(actor.character.root);
      });
    }
  };

  const ui = new Ui(root, {
    assets,
    get thumbnails() {
      return thumbnails;
    },
    look: () => player.character.look,
    blockedBy: (slot: SlotId) => {
      const look = player.character.look;
      return assets.catalog.slots
        .map((s) => look.items[s.id])
        .filter((id): id is string => !!id)
        .map((id) => assets.item(id))
        .find((item) => item.blocks?.includes(slot));
    },
    itemsChanged: () => void rebuildPlayer(),
    colorsChanged: () => {
      player.character.recolor();
      saveLook(player.character.look);
    },
    faceChanged: () => {
      player.character.redrawFace();
      saveLook(player.character.look);
    },
    shuffle: () => {
      player.character.look = randomLook(assets);
      void rebuildPlayer().then(() => ui.refresh());
    },
    setMode: (next) => {
      mode = next;
      world.mode = next;
      turntable = 0;
      player.target = null;
      player.faceYaw = next === 'dress' ? world.cameraYaw : null;
      // The wardrobe shows the hero alone.
      for (const { actor } of crowd) actor.character.root.visible = next === 'play';
    },
    perform: (action) => player.perform(action),
    setGait: (next) => (gait = next),
    setCrowd,
    setToggle: (name, on) => {
      settings[name] = on;
      if (name === 'shadows') world.shadows = on;
      for (const actor of everyone()) {
        actor.character.outlineVisible = settings.outline;
        actor.character.juice.enabled = settings.juice;
        actor.character.springsEnabled = settings.juice;
      }
    },
  });

  world = new World(ui.canvasHost);
  thumbnails = new Thumbnails(world.renderer, assets, materials);
  new ResizeObserver(() => world.resize()).observe(ui.canvasHost);
  new ResizeObserver(() => (world.bottomInset = ui.bottomBar.offsetHeight + 12)).observe(ui.bottomBar);
  world.resize();

  await rebuildPlayer();
  world.scene.add(player.character.root);
  player.place(0, 0, world.cameraYaw);
  setCrowd(5);

  // ---- input: tap to walk, drag to turn in the wardrobe, keys to steer
  const canvas = world.renderer.domElement;
  let press: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    press = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!press) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press.moved = true;
    if (mode === 'dress') {
      turntable += e.movementX * 0.012;
      ui.dismissHint();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const tap = press && !press.moved;
    press = null;
    if (!tap || mode !== 'play') return;
    const point = world.groundPoint(e.clientX, e.clientY);
    if (!point) return;
    player.moveTo(point, point.distanceTo(player.position) > 1.8);
    world.showMarker(point);
    ui.dismissHint();
  });
  canvas.addEventListener('pointercancel', () => (press = null));

  const keys = new Set<string>();
  const steerKeys: Record<string, [number, number]> = {
    KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0],
    KeyD: [0, 1], ArrowRight: [0, 1], KeyA: [0, -1], ArrowLeft: [0, -1],
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code in steerKeys) {
      keys.add(e.code);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // ---- frame loop
  let last = performance.now();
  let fps = 60;
  let workMs = 0;
  let statsIn = 0;
  world.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const frame = (now - last) / 1000;
    last = now;
    const dt = Math.min(frame, 0.05);
    if (frame > 0) fps += (1 / frame - fps) * 0.08;

    player.steer.set(0, 0, 0);
    if (mode === 'play' && keys.size) {
      const { forward, right } = world.screenAxes();
      for (const code of keys) {
        const [f, r] = steerKeys[code];
        player.steer.addScaledVector(forward, f).addScaledVector(right, r);
      }
      if (player.steer.lengthSq() > 1) player.steer.normalize();
      if (player.steer.lengthSq() > 0) ui.dismissHint();
    }
    if (mode === 'dress') player.faceYaw = world.cameraYaw + turntable;

    for (const { brain } of crowd) brain.update(dt);
    // In the wardrobe the hero can walk or run on the spot so clothes can be judged in motion.
    const { animator } = player.character;
    player.treadmill = mode !== 'dress' || gait === 'stand' ? 0 : gait === 'walk' ? animator.walkSpeed : animator.runSpeed;
    for (const actor of everyone()) actor.update(dt);
    separate(everyone());

    world.focus.copy(player.position);
    world.update(dt);
    world.render();

    workMs += (performance.now() - now - workMs) * 0.1;
    statsIn -= frame;
    if (statsIn <= 0) {
      statsIn = 0.5;
      const info = world.renderer.info.render;
      ui.setStats({
        fps,
        frameMs: workMs,
        drawCalls: info.calls,
        triangles: info.triangles,
        characters: everyone().length,
        player: player.character.stats,
      });
    }
  });

  if (import.meta.env.DEV) Object.assign(window, { app: { world, player, crowd, assets, ui, THREE } });
  document.body.dataset.ready = '1';
}

start().catch((error) => {
  console.error(error);
  root.replaceChildren(
    Object.assign(document.createElement('p'), {
      className: 'loading',
      textContent: 'The characters could not be loaded. Check that this browser supports WebGL 2, then reload.',
    }),
  );
});
