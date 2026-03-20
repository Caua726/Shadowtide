// Weapon effects, projectile rendering, melee effects
import { Graphics } from "https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/pixi.min.mjs";
import { PROJECTILE_COLORS } from "./constants.js";

export const clientProjectiles = new Map();
export const effects = [];

export function setupWeaponMessages(room, world) {
  room.onMessage("swing", ({ id, x, y, dx, dy }) => {
    const angle = Math.atan2(dy || 1, dx || 0);
    const fx = new Graphics();
    fx.arc(x, y, 42, angle - 0.7, angle + 0.7).stroke({ color: id === room.sessionId ? 0x8bd3ff : 0xffc1c1, width: 5 });
    fx.life = 0.12;
    world.addChild(fx);
    effects.push(fx);
  });

  room.onMessage("projectile_fired", ({ id, type, x, y, dx, dy, speed, isEnemy }) => {
    const g = new Graphics();
    const color = PROJECTILE_COLORS[type] || (isEnemy ? 0xff4444 : 0xffff00);
    g.circle(0, 0, isEnemy ? 4 : 5).fill(color);
    g.x = x; g.y = y; g._dx = dx; g._dy = dy; g._speed = speed; g._life = 3;
    world.addChild(g);
    clientProjectiles.set(id, g);
  });

  room.onMessage("projectile_hit", ({ id }) => {
    const g = clientProjectiles.get(id);
    if (g) { world.removeChild(g); clientProjectiles.delete(id); }
  });

  room.onMessage("explosion", ({ x, y, radius }) => {
    const g = new Graphics();
    g.circle(x, y, radius).fill({ color: 0xff4400, alpha: 0.4 });
    g.circle(x, y, radius * 0.6).fill({ color: 0xffaa00, alpha: 0.5 });
    g.life = 0.3;
    world.addChild(g);
    effects.push(g);
  });
}

export function updateProjectiles(dt, world) {
  for (const [id, g] of clientProjectiles) {
    g.x += g._dx * g._speed * dt;
    g.y += g._dy * g._speed * dt;
    g._life -= dt;
    if (g._life <= 0) { world.removeChild(g); clientProjectiles.delete(id); }
  }
}

export function updateEffects(dt, world) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.life -= dt;
    fx.alpha = Math.max(0, fx.life / (fx.life + dt + 0.01));
    if (fx.life <= 0) { world.removeChild(fx); effects.splice(i, 1); }
  }
}
