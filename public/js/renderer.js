// PixiJS setup, world container, camera
import { Application, Container, Graphics } from "https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/pixi.min.mjs";

export let app, world, floor;

export async function initRenderer() {
  app = new Application();
  await app.init({ resizeTo: window, background: "#0b1020", antialias: true });
  document.body.appendChild(app.canvas);

  world = new Container();
  app.stage.addChild(world);

  floor = new Graphics();
  world.addChild(floor);

  return { app, world };
}

export function redrawFloor(w, h) {
  floor.clear();
  floor.rect(0, 0, w, h).fill(0x101933);
  for (let x = 0; x <= w; x += 64) floor.moveTo(x, 0).lineTo(x, h);
  for (let y = 0; y <= h; y += 64) floor.moveTo(0, y).lineTo(w, y);
  floor.stroke({ color: 0x1a2850, width: 1 });
}

export function updateCamera(me, screenW, screenH, worldW, worldH) {
  const cx = screenW / 2 - me.x;
  const cy = screenH / 2 - me.y;
  world.x = Math.min(0, Math.max(screenW - worldW, cx));
  world.y = Math.min(0, Math.max(screenH - worldH, cy));
}

// Mouse tracking
export let mouseWorldX = 0, mouseWorldY = 0;
export function initMouseTracking(canvas) {
  canvas.addEventListener("mousemove", (e) => {
    mouseWorldX = e.clientX - world.x;
    mouseWorldY = e.clientY - world.y;
  });
}
