// Player and enemy sprite creation
import { Container, Graphics, Text, TextStyle } from "https://cdn.jsdelivr.net/npm/pixi.js@8.16.0/dist/pixi.min.mjs";
import { ENEMY_COLORS, RARITY_HEX, WEAPON_SPRITE_COLORS } from "./constants.js";

// --- Weapon graphics on player ---
export function makeWeaponGraphic(weaponType, rarity) {
  const g = new Graphics();
  const base = WEAPON_SPRITE_COLORS[weaponType] || 0xcccccc;
  const rc = RARITY_HEX[rarity] || 0xffffff;
  switch (weaponType) {
    case "sword":
      g.rect(14, -2, 20, 4).fill(base).rect(10, -4, 6, 8).fill(0xc28b2c);
      if (rarity > 0) g.rect(14, -2, 20, 4).stroke({ color: rc, width: 1 });
      break;
    case "hammer":
      g.rect(12, -2, 14, 4).fill(0x8b5e3c).rect(24, -8, 10, 16).fill(base);
      if (rarity > 0) g.rect(24, -8, 10, 16).stroke({ color: rc, width: 1 });
      break;
    case "bow":
      g.moveTo(10, -10).quadraticCurveTo(22, 0, 10, 10).stroke({ color: base, width: 2 });
      g.moveTo(10, -8).lineTo(10, 8).stroke({ color: 0xc28b2c, width: 1 });
      break;
    case "staff":
      g.rect(10, -2, 24, 3).fill(0x8b5e3c).circle(34, 0, 5).fill(base);
      if (rarity > 0) g.circle(34, 0, 6).stroke({ color: rc, width: 1 });
      break;
    case "pistol":
      g.rect(10, -3, 14, 6).fill(base).rect(10, 3, 6, 6).fill(0x555555);
      break;
    case "shotgun":
      g.rect(8, -3, 22, 6).fill(base).rect(8, 3, 8, 5).fill(0x555555);
      g.circle(30, 0, 2).fill(0xff8800);
      break;
    case "arcaneOrb":
      g.circle(18, 0, 7).fill({ color: base, alpha: 0.7 });
      g.circle(18, 0, 9).stroke({ color: rc, width: 1.5 });
      break;
  }
  return g;
}

export function makePlayer(label, color) {
  const c = new Container();
  const body = new Graphics().circle(0, 0, 16).fill(color).circle(0, -3, 6).fill(0xffffff);
  const weapon = makeWeaponGraphic("sword", 0);
  const text = new Text({ text: label, style: new TextStyle({ fill: 0xffffff, fontSize: 12, fontWeight: "600" }) });
  text.anchor.set(0.5); text.y = -28;
  c.addChild(body, weapon, text);
  c._weapon = weapon;
  return c;
}

export function updatePlayerWeapon(sprite, weaponType, rarity) {
  const key = `${weaponType}_${rarity}`;
  if (sprite._curWeapon === key) return;
  sprite._curWeapon = key;
  const idx = sprite.getChildIndex(sprite._weapon);
  sprite.removeChild(sprite._weapon);
  sprite._weapon.destroy();
  const newW = makeWeaponGraphic(weaponType, rarity);
  sprite.addChildAt(newW, idx);
  sprite._weapon = newW;
}

// --- Enemy sprites ---
export function makeEnemy(enemyType, isBoss) {
  const c = new Container();
  const color = ENEMY_COLORS[enemyType] || 0xff6b6b;
  if (isBoss) c.scale.set(1.5);
  let body;
  switch (enemyType) {
    case "slime": body = new Graphics().ellipse(0, 2, 14, 10).fill(color).circle(-4, -2, 2).fill(0xfff).circle(4, -2, 2).fill(0xfff); break;
    case "skeleton": body = new Graphics().rect(-6, -14, 12, 28).fill(color).circle(-3, -8, 2).fill(0x333).circle(3, -8, 2).fill(0x333); break;
    case "archer": body = new Graphics().rect(-6, -14, 12, 28).fill(color).rect(8, -10, 3, 20).fill(0x654321); break;
    case "wolf": body = new Graphics().ellipse(0, 0, 16, 10).fill(color).moveTo(14, -4).lineTo(22, -8).lineTo(14, 0).fill(color); break;
    case "golem": body = new Graphics().roundRect(-16, -16, 32, 32, 4).fill(color); break;
    case "necromancer": body = new Graphics().moveTo(0, -16).lineTo(12, 12).lineTo(-12, 12).closePath().fill(color).circle(0, -4, 3).fill(0x00ff00); break;
    case "creeper": body = new Graphics().roundRect(-10, -14, 20, 28, 6).fill(color).circle(-3, -6, 2).fill(0x000).circle(3, -6, 2).fill(0x000); break;
    case "sorcerer": body = new Graphics().circle(0, 0, 12).fill(color).circle(0, -14, 6).fill(0x2980b9); break;
    default: body = new Graphics().roundRect(-14, -12, 28, 24, 8).fill(color);
  }
  const hpBg = new Graphics().rect(-18, -24, 36, 4).fill(0x000000, 0.45);
  const hpBar = new Graphics();
  c.addChild(body, hpBg, hpBar);
  c._hpBar = hpBar;
  return c;
}

export function updateEnemyBar(sprite, enemy) {
  sprite._hpBar.clear();
  const r = Math.max(0, enemy.hp / Math.max(1, enemy.maxHp));
  sprite._hpBar.rect(-18, -24, 36 * r, 4).fill(0x80ff88);
}

export function makeFloatingText(v) {
  return new Text({ text: v, style: new TextStyle({ fill: 0xffffff, fontSize: 12, fontWeight: "700", stroke: { color: 0x000000, width: 3 } }) });
}
