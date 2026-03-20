export type WeaponType = "sword" | "hammer" | "bow" | "staff" | "pistol" | "shotgun" | "arcaneOrb";
export type WeaponCategory = "melee" | "ranged" | "magic" | "firearm";
export type ScalingAttr = "str" | "dex" | "intel";

export interface WeaponDef {
  type: WeaponType;
  category: WeaponCategory;
  cooldownMs: number;
  baseDamage: number;
  projectileSpeed: number;
  range: number;
  scalingAttr: ScalingAttr;
  knockback?: number;
  aoeRadius?: number;
  pelletCount?: number;
  coneAngle?: number;
  homingTurnRate?: number;
}

export const WEAPON_DEFS: Record<WeaponType, WeaponDef> = {
  sword:     { type: "sword",     category: "melee",   cooldownMs: 350, baseDamage: 14, projectileSpeed: 0,   range: 90,  scalingAttr: "str" },
  hammer:    { type: "hammer",    category: "melee",   cooldownMs: 600, baseDamage: 24, projectileSpeed: 0,   range: 90,  scalingAttr: "str", knockback: 80 },
  bow:       { type: "bow",       category: "ranged",  cooldownMs: 400, baseDamage: 12, projectileSpeed: 500, range: 600, scalingAttr: "dex" },
  staff:     { type: "staff",     category: "magic",   cooldownMs: 700, baseDamage: 18, projectileSpeed: 350, range: 600, scalingAttr: "intel", aoeRadius: 60 },
  pistol:    { type: "pistol",    category: "firearm", cooldownMs: 200, baseDamage: 7,  projectileSpeed: 700, range: 500, scalingAttr: "dex" },
  shotgun:   { type: "shotgun",   category: "firearm", cooldownMs: 650, baseDamage: 5,  projectileSpeed: 550, range: 300, scalingAttr: "str", pelletCount: 5, coneAngle: Math.PI / 6 },
  arcaneOrb: { type: "arcaneOrb", category: "magic",   cooldownMs: 500, baseDamage: 10, projectileSpeed: 300, range: 800, scalingAttr: "intel", homingTurnRate: 3 },
};

export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"] as const;
export const RARITY_MULTIPLIERS = [1.0, 1.2, 1.5, 2.0, 3.0];
export const RARITY_COLORS = [0xffffff, 0x4ade80, 0x60a5fa, 0xc084fc, 0xfbbf24];

export function computeWeaponDamage(
  weaponType: WeaponType,
  rarity: number,
  playerAttrs: { str: number; dex: number; intel: number },
): number {
  const def = WEAPON_DEFS[weaponType];
  const attrValue = playerAttrs[def.scalingAttr];
  return Math.round(def.baseDamage * RARITY_MULTIPLIERS[rarity] * (1 + attrValue * 0.03));
}

export function getWeaponCooldown(weaponType: WeaponType, dex: number): number {
  const def = WEAPON_DEFS[weaponType];
  const speedMultiplier = 1 / (1 + dex * 0.005);
  return Math.round(def.cooldownMs * speedMultiplier);
}

const DROP_WEIGHTS = {
  normal:     [60, 30, 8, 2, 0],
  wave10:     [40, 35, 18, 6, 1],
  boss:       [0, 20, 45, 25, 10],
  bossWave25: [0, 0, 30, 40, 30],
};

export function rollRarity(isBoss: boolean, waveNumber: number, lck: number): number {
  let weights: number[];
  if (isBoss && waveNumber >= 25) weights = [...DROP_WEIGHTS.bossWave25];
  else if (isBoss) weights = [...DROP_WEIGHTS.boss];
  else if (waveNumber >= 10) weights = [...DROP_WEIGHTS.wave10];
  else weights = [...DROP_WEIGHTS.normal];

  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  let rarity = 0;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { rarity = i; break; }
  }

  if (rarity < 4 && Math.random() < lck * 0.005) {
    rarity++;
  }

  return rarity;
}

export function rollWeaponType(): WeaponType {
  const types = Object.keys(WEAPON_DEFS) as WeaponType[];
  return types[Math.floor(Math.random() * types.length)];
}

export interface Projectile {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  maxRange: number;
  distanceTraveled: number;
  damage: number;
  ownerId: string;
  isEnemy: boolean;
  aoeRadius?: number;
  homingTurnRate?: number;
  targetId?: string;
}
