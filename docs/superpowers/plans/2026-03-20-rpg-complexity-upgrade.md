# RPG Complexity Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing simple hack-and-slash into a wave-based survival RPG with 7 weapon types, 8 enemy types, bosses, 5 attributes, and a PoE-style skill tree.

**Architecture:** Server-authoritative Colyseus game. All game logic runs server-side in TypeScript. Client is a single HTML file using PixiJS 8 from CDN with `@colyseus/schema` v4 Callbacks API. Projectiles are NOT synced via schema — they use broadcast messages for client rendering and server-side arrays for hit detection. No test framework — verification is manual (start server, open browser, play).

**Tech Stack:** Colyseus 0.17.8, @colyseus/schema 4.0.19, PixiJS 8.16.0, TypeScript, tsx (dev runner), single-file HTML client.

**Spec:** `docs/superpowers/specs/2026-03-20-rpg-complexity-upgrade-design.md`

---

## File Map

### Files to Create
- `src/rooms/WeaponSystem.ts` — Weapon base definitions (7 weapons), rarity multipliers, damage formula, projectile creation
- `src/rooms/EnemyBehaviors.ts` — AI logic per enemy type (8 types), boss overrides, enemy stat definitions
- `src/rooms/SkillTree.ts` — Node graph (~40 nodes), adjacency validation, buff computation, reset logic

### Files to Modify
- `src/rooms/GameState.ts` — Expand Player, Enemy schemas; add WaveState, DroppedItem schemas
- `src/rooms/GameRoom.ts` — Wave system, new attack/projectile system, drop system, attribute/perk messages, skill tree messages
- `public/index.html` — Enemy type visuals, projectile rendering, drop rendering, wave HUD, attribute UI, skill tree UI, weapon HUD
- `src/server.ts` — No changes needed

---

## Phase 1: Server Foundation (Schemas + Systems)

### Task 1: Expand Schemas (GameState.ts)

**Files:**
- Modify: `src/rooms/GameState.ts`

This is the foundation — all other tasks depend on these schemas.

- [ ] **Step 1: Add ArraySchema import and WaveState schema**

Add to `src/rooms/GameState.ts`:
```typescript
import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class WaveState extends Schema {
  @type("number") waveNumber = 0;
  @type("string") state: "waiting" | "combat" | "pause" = "waiting";
  @type("number") timer = 0;
  @type("number") enemiesRemaining = 0;
}
```

- [ ] **Step 2: Add DroppedItem schema**

```typescript
export class DroppedItem extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") weaponType = "sword";
  @type("number") weaponRarity = 0; // 0=Common,1=Uncommon,2=Rare,3=Epic,4=Legendary
  @type("number") ttl = 30;
}
```

- [ ] **Step 3: Expand Player schema**

Replace the existing Player class. Remove `damage` field (now computed). Add attribute fields, weapon fields, skill tree fields, and derived stat fields:

```typescript
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("number") x = 400;
  @type("number") y = 300;
  @type("number") hp = 100;
  @type("number") maxHp = 100;
  @type("number") level = 1;
  @type("number") xp = 0;
  @type("number") xpToNext = 40;
  @type("number") lastMoveX = 0;
  @type("number") lastMoveY = 1;
  // Attributes
  @type("number") str = 0;
  @type("number") dex = 0;
  @type("number") vit = 0;
  @type("number") intel = 0;
  @type("number") lck = 0;
  @type("number") unspentPoints = 0;
  @type("number") perkPoints = 0;
  // Weapon
  @type("string") equippedWeaponType = "sword";
  @type("number") equippedWeaponRarity = 0;
  // Skill tree
  @type(["string"]) activeSkillNodes = new ArraySchema<string>();
  // Derived stats (computed from attributes + skill tree, cached for client display)
  @type("number") moveSpeed = 180;
  @type("number") critChance = 0;
  @type("number") hpRegen = 0;
}
```

- [ ] **Step 4: Expand Enemy schema**

Add `enemyType`, `isBoss`, and `damage` fields:

```typescript
export class Enemy extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") hp = 30;
  @type("number") maxHp = 30;
  @type("number") speed = 55;
  @type("number") xpReward = 15;
  @type("string") enemyType = "slime";
  @type("boolean") isBoss = false;
  @type("number") damage = 8;
}
```

- [ ] **Step 5: Expand GameState**

Add `droppedItems` map and nested `wave` state:

```typescript
export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: FloatingText }) floatingTexts = new MapSchema<FloatingText>();
  @type({ map: DroppedItem }) droppedItems = new MapSchema<DroppedItem>();
  @type(WaveState) wave = new WaveState();
  @type("number") worldWidth = 1600;
  @type("number") worldHeight = 1200;
}
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors (GameRoom.ts will have errors since it references `player.damage` — that's expected and will be fixed in Task 4).

- [ ] **Step 7: Commit**

```bash
git add src/rooms/GameState.ts
git commit -m "feat: expand schemas for wave system, weapons, attributes, skill tree"
```

---

### Task 2: Create WeaponSystem.ts

**Files:**
- Create: `src/rooms/WeaponSystem.ts`

- [ ] **Step 1: Define weapon base stats and rarity system**

Create `src/rooms/WeaponSystem.ts`:

```typescript
export type WeaponType = "sword" | "hammer" | "bow" | "staff" | "pistol" | "shotgun" | "arcaneOrb";
export type WeaponCategory = "melee" | "ranged" | "magic" | "firearm";
export type ScalingAttr = "str" | "dex" | "intel";

export interface WeaponDef {
  type: WeaponType;
  category: WeaponCategory;
  cooldownMs: number;
  baseDamage: number;
  projectileSpeed: number; // 0 for melee
  range: number; // arc radius for melee, max range for ranged
  scalingAttr: ScalingAttr;
  // Special properties
  knockback?: number;
  aoeRadius?: number;
  pelletCount?: number;
  coneAngle?: number; // radians
  homingTurnRate?: number; // rad/s
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
  // DEX reduces cooldown: each point = 0.5% faster
  const speedMultiplier = 1 / (1 + dex * 0.005);
  return Math.round(def.cooldownMs * speedMultiplier);
}
```

- [ ] **Step 2: Add drop rarity roller**

Append to `src/rooms/WeaponSystem.ts`:

```typescript
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

  // LCK: +0.5% per point chance to upgrade tier by one
  if (rarity < 4 && Math.random() < lck * 0.005) {
    rarity++;
  }

  return rarity;
}

export function rollWeaponType(): WeaponType {
  const types = Object.keys(WEAPON_DEFS) as WeaponType[];
  return types[Math.floor(Math.random() * types.length)];
}
```

- [ ] **Step 3: Add projectile interface**

Append to `src/rooms/WeaponSystem.ts`:

```typescript
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
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: WeaponSystem.ts compiles cleanly. GameRoom.ts may still have errors (fixed in Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/rooms/WeaponSystem.ts
git commit -m "feat: add weapon system with 7 types, rarity, damage calc, projectiles"
```

---

### Task 3: Create EnemyBehaviors.ts

**Files:**
- Create: `src/rooms/EnemyBehaviors.ts`

- [ ] **Step 1: Define enemy type definitions and stat table**

Create `src/rooms/EnemyBehaviors.ts`:

```typescript
import type { Enemy, Player } from "./GameState.js";

export type EnemyTypeName = "slime" | "skeleton" | "archer" | "wolf" | "golem" | "necromancer" | "creeper" | "sorcerer";

export interface EnemyDef {
  type: EnemyTypeName;
  baseHp: number;
  baseDamage: number;
  speed: number;
  xpReward: number;
  firstWave: number;
}

export const ENEMY_DEFS: Record<EnemyTypeName, EnemyDef> = {
  slime:       { type: "slime",       baseHp: 20,  baseDamage: 8,  speed: 40,  xpReward: 8,  firstWave: 1 },
  skeleton:    { type: "skeleton",    baseHp: 30,  baseDamage: 12, speed: 55,  xpReward: 12, firstWave: 2 },
  archer:      { type: "archer",      baseHp: 18,  baseDamage: 10, speed: 45,  xpReward: 14, firstWave: 3 },
  wolf:        { type: "wolf",        baseHp: 15,  baseDamage: 10, speed: 100, xpReward: 10, firstWave: 4 },
  golem:       { type: "golem",       baseHp: 100, baseDamage: 20, speed: 25,  xpReward: 25, firstWave: 6 },
  necromancer: { type: "necromancer", baseHp: 25,  baseDamage: 6,  speed: 35,  xpReward: 20, firstWave: 8 },
  creeper:     { type: "creeper",     baseHp: 30,  baseDamage: 40, speed: 70,  xpReward: 18, firstWave: 10 },
  sorcerer:    { type: "sorcerer",    baseHp: 20,  baseDamage: 14, speed: 40,  xpReward: 22, firstWave: 12 },
};

// Returns list of enemy types available for the given wave
export function getAvailableTypes(waveNumber: number): EnemyTypeName[] {
  return (Object.values(ENEMY_DEFS) as EnemyDef[])
    .filter(d => waveNumber >= d.firstWave)
    .map(d => d.type);
}

// Apply wave scaling to base stats
export function scaleStats(def: EnemyDef, waveNumber: number, isBoss: boolean): { hp: number; damage: number; speed: number; xpReward: number } {
  const hpScale = Math.pow(1.08, waveNumber);
  const dmgScale = Math.pow(1.05, waveNumber);
  let hp = Math.round(def.baseHp * hpScale);
  let damage = Math.round(def.baseDamage * dmgScale);
  let speed = def.speed;
  let xpReward = Math.round(def.xpReward * (1 + waveNumber * 0.1));

  if (isBoss) {
    hp *= 10;
    damage *= 3;
    speed *= 0.8; // bosses slightly slower
    xpReward *= 5;
  }

  return { hp, damage, speed, xpReward };
}
```

- [ ] **Step 2: Define AI behavior result and per-type behavior functions**

Append to `src/rooms/EnemyBehaviors.ts`:

```typescript
import type { Projectile } from "./WeaponSystem.js";

export interface AIAction {
  moveX: number; // normalized direction
  moveY: number;
  shoot?: { dx: number; dy: number; speed: number; damage: number; maxRange: number; homingTurnRate?: number; targetId?: string };
  heal?: { radius: number; amount: number };
  explode?: { radius: number; damage: number };
  slam?: { radius: number; damage: number }; // boss creeper
}

function findNearest(enemy: Enemy, players: Iterable<Player>): { player: Player; dist: number } | null {
  let nearest: Player | null = null;
  let bestDist = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.x - enemy.x, p.y - enemy.y);
    if (d < bestDist) { bestDist = d; nearest = p; }
  }
  return nearest ? { player: nearest, dist: bestDist } : null;
}

function dirTo(from: { x: number; y: number }, to: { x: number; y: number }): { dx: number; dy: number; len: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { dx: dx / len, dy: dy / len, len };
}

// Track cooldowns per enemy for ranged attacks and abilities
const cooldowns = new Map<string, number>();

export function clearEnemyCooldowns(enemyId: string) {
  for (const key of cooldowns.keys()) {
    if (key.startsWith(enemyId + ":")) cooldowns.delete(key);
  }
}

export function clearAllCooldowns() {
  cooldowns.clear();
}

function checkCooldown(enemyId: string, ability: string, cooldownMs: number, now: number): boolean {
  const key = `${enemyId}:${ability}`;
  const last = cooldowns.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  cooldowns.set(key, now);
  return true;
}

// Count wolves near an enemy for pack bonus
function countNearbyWolves(enemy: Enemy, allEnemies: Iterable<Enemy>): number {
  let count = 0;
  for (const e of allEnemies) {
    if (e.id !== enemy.id && e.enemyType === "wolf" && Math.hypot(e.x - enemy.x, e.y - enemy.y) <= 80) {
      count++;
    }
  }
  return count;
}

export function getEnemyAI(
  enemy: Enemy,
  players: Iterable<Player>,
  allEnemies: Iterable<Enemy>,
  now: number,
): AIAction {
  const target = findNearest(enemy, players);
  if (!target) return { moveX: 0, moveY: 0 };

  const { player, dist } = target;
  const dir = dirTo(enemy, player);
  const type = enemy.enemyType as EnemyTypeName;

  switch (type) {
    case "slime":
    case "skeleton":
      return { moveX: dir.dx, moveY: dir.dy };

    case "archer": {
      // Flee if too close, keep distance at 200px, shoot at 800ms cooldown
      if (dist < 100) {
        return { moveX: -dir.dx, moveY: -dir.dy };
      }
      const action: AIAction = { moveX: 0, moveY: 0 };
      if (dist > 220) {
        action.moveX = dir.dx;
        action.moveY = dir.dy;
      }
      if (checkCooldown(enemy.id, "shoot", 800, now)) {
        action.shoot = { dx: dir.dx, dy: dir.dy, speed: 400, damage: enemy.damage, maxRange: 500 };
      }
      return action;
    }

    case "wolf": {
      const action: AIAction = { moveX: dir.dx, moveY: dir.dy };
      // Pack bonus handled in damage application, not in AI
      return action;
    }

    case "golem":
      return { moveX: dir.dx, moveY: dir.dy };

    case "necromancer": {
      const action: AIAction = { moveX: 0, moveY: 0 };
      if (dist < 150) {
        action.moveX = -dir.dx;
        action.moveY = -dir.dy;
      } else if (dist > 180) {
        action.moveX = dir.dx;
        action.moveY = dir.dy;
      }
      const healAmount = enemy.isBoss ? 15 : 5;
      const healRadius = enemy.isBoss ? 150 : 80;
      if (checkCooldown(enemy.id, "heal", 2000, now)) {
        action.heal = { radius: healRadius, amount: healAmount };
      }
      return action;
    }

    case "creeper": {
      if (enemy.isBoss) {
        // Boss creeper: chase + slam every 3s
        const action: AIAction = { moveX: dir.dx, moveY: dir.dy };
        if (dist < 110 && checkCooldown(enemy.id, "slam", 3000, now)) {
          action.slam = { radius: 100, damage: enemy.damage };
        }
        return action;
      }
      // Normal creeper: rush and explode on contact
      const action: AIAction = { moveX: dir.dx, moveY: dir.dy };
      if (dist < 30) {
        action.explode = { radius: 100, damage: enemy.damage };
      }
      return action;
    }

    case "sorcerer": {
      const action: AIAction = { moveX: 0, moveY: 0 };
      if (dist < 200) {
        action.moveX = -dir.dx;
        action.moveY = -dir.dy;
      } else if (dist > 270) {
        action.moveX = dir.dx;
        action.moveY = dir.dy;
      }
      if (checkCooldown(enemy.id, "shoot", 1200, now)) {
        action.shoot = {
          dx: dir.dx, dy: dir.dy, speed: 250, damage: enemy.damage, maxRange: 400,
          homingTurnRate: 2, targetId: player.id,
        };
      }
      return action;
    }

    default:
      return { moveX: dir.dx, moveY: dir.dy };
  }
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: EnemyBehaviors.ts compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/rooms/EnemyBehaviors.ts
git commit -m "feat: add enemy behaviors with 8 types, AI logic, boss overrides"
```

---

### Task 4: Create SkillTree.ts

**Files:**
- Create: `src/rooms/SkillTree.ts`

- [ ] **Step 1: Define node types and the node graph**

Create `src/rooms/SkillTree.ts` with the complete node graph. ~40 nodes across 3 regions + center + major nodes:

```typescript
export interface SkillNode {
  id: string;
  name: string;
  region: "combat" | "defense" | "utility" | "center" | "major";
  cost: number; // 1 or 2 for major nodes
  connections: string[]; // adjacent node IDs
  effects: SkillEffect[];
  // Position for client rendering (normalized 0-1 coordinates)
  px: number;
  py: number;
}

export interface SkillEffect {
  type: SkillEffectType;
  value: number;
}

export type SkillEffectType =
  | "meleeDamagePercent"
  | "rangedDamagePercent"
  | "attackSpeedPercent"
  | "critDamageFlat"       // added to crit multiplier (base 2.0)
  | "doubleStrikeChance"   // 0-1
  | "vampirismPercent"     // % of damage healed
  | "maxHpPercent"
  | "hpRegenFlat"          // HP/s
  | "killShieldHp"
  | "damageReductionPercent"
  | "secondChance"         // boolean (value=1 means active)
  | "moveSpeedPercent"
  | "pickupRadiusPercent"
  | "dropChancePercent"
  | "dropRarityShift"
  | "xpBonusPercent"
  | "allyDamageAuraPercent"
  | "berserkerDamagePercent" // conditional: below 30% HP
  ;

// Center node — always active, no cost, starting point
const CENTER: SkillNode = {
  id: "center", name: "Origin", region: "center", cost: 0,
  connections: ["c1", "d1", "u1"],
  effects: [],
  px: 0.5, py: 0.5,
};

// Combat nodes (c1-c14) — upper-left region
const COMBAT_NODES: SkillNode[] = [
  { id: "c1", name: "Sharpness I", region: "combat", cost: 1, connections: ["center", "c2", "c3"], effects: [{ type: "meleeDamagePercent", value: 5 }], px: 0.38, py: 0.42 },
  { id: "c2", name: "Precision I", region: "combat", cost: 1, connections: ["c1", "c4", "c5"], effects: [{ type: "rangedDamagePercent", value: 5 }], px: 0.28, py: 0.35 },
  { id: "c3", name: "Swift Strikes", region: "combat", cost: 1, connections: ["c1", "c6", "mc1"], effects: [{ type: "attackSpeedPercent", value: 5 }], px: 0.42, py: 0.32 },
  { id: "c4", name: "Sharpness II", region: "combat", cost: 1, connections: ["c2", "c7"], effects: [{ type: "meleeDamagePercent", value: 8 }], px: 0.2, py: 0.28 },
  { id: "c5", name: "Precision II", region: "combat", cost: 1, connections: ["c2", "c7", "c8"], effects: [{ type: "rangedDamagePercent", value: 8 }], px: 0.3, py: 0.22 },
  { id: "c6", name: "Ferocity", region: "combat", cost: 1, connections: ["c3", "c8", "c9"], effects: [{ type: "attackSpeedPercent", value: 8 }], px: 0.45, py: 0.2 },
  { id: "c7", name: "Devastation", region: "combat", cost: 1, connections: ["c4", "c5", "c10"], effects: [{ type: "meleeDamagePercent", value: 5 }, { type: "rangedDamagePercent", value: 5 }], px: 0.22, py: 0.15 },
  { id: "c8", name: "Devastating Crit", region: "combat", cost: 1, connections: ["c5", "c6", "c10"], effects: [{ type: "critDamageFlat", value: 0.5 }], px: 0.35, py: 0.12 },
  { id: "c9", name: "Double Strike", region: "combat", cost: 1, connections: ["c6", "c11"], effects: [{ type: "doubleStrikeChance", value: 0.15 }], px: 0.5, py: 0.1 },
  { id: "c10", name: "Sharpness III", region: "combat", cost: 1, connections: ["c7", "c8", "c11"], effects: [{ type: "meleeDamagePercent", value: 10 }], px: 0.28, py: 0.05 },
  { id: "c11", name: "Vampirism", region: "combat", cost: 1, connections: ["c9", "c10"], effects: [{ type: "vampirismPercent", value: 5 }], px: 0.42, py: 0.03 },
];

// Defense nodes (d1-d12) — lower-left region
const DEFENSE_NODES: SkillNode[] = [
  { id: "d1", name: "Toughness I", region: "defense", cost: 1, connections: ["center", "d2", "d3"], effects: [{ type: "maxHpPercent", value: 5 }], px: 0.38, py: 0.58 },
  { id: "d2", name: "Regeneration I", region: "defense", cost: 1, connections: ["d1", "d4", "d5"], effects: [{ type: "hpRegenFlat", value: 0.5 }], px: 0.28, py: 0.65 },
  { id: "d3", name: "Thick Skin", region: "defense", cost: 1, connections: ["d1", "d6", "mc1"], effects: [{ type: "damageReductionPercent", value: 3 }], px: 0.42, py: 0.68 },
  { id: "d4", name: "Toughness II", region: "defense", cost: 1, connections: ["d2", "d7"], effects: [{ type: "maxHpPercent", value: 8 }], px: 0.2, py: 0.72 },
  { id: "d5", name: "Regeneration II", region: "defense", cost: 1, connections: ["d2", "d7", "d8"], effects: [{ type: "hpRegenFlat", value: 1.0 }], px: 0.3, py: 0.78 },
  { id: "d6", name: "Iron Will", region: "defense", cost: 1, connections: ["d3", "d8", "d9"], effects: [{ type: "damageReductionPercent", value: 5 }], px: 0.45, py: 0.8 },
  { id: "d7", name: "Toughness III", region: "defense", cost: 1, connections: ["d4", "d5", "d10"], effects: [{ type: "maxHpPercent", value: 10 }], px: 0.22, py: 0.85 },
  { id: "d8", name: "Kill Shield", region: "defense", cost: 1, connections: ["d5", "d6", "d10"], effects: [{ type: "killShieldHp", value: 10 }], px: 0.35, py: 0.88 },
  { id: "d9", name: "Fortitude", region: "defense", cost: 1, connections: ["d6", "d11", "mc2"], effects: [{ type: "damageReductionPercent", value: 8 }], px: 0.52, py: 0.88 },
  { id: "d10", name: "Regeneration III", region: "defense", cost: 1, connections: ["d7", "d8", "d11"], effects: [{ type: "hpRegenFlat", value: 1.5 }], px: 0.28, py: 0.95 },
  { id: "d11", name: "Second Chance", region: "defense", cost: 1, connections: ["d9", "d10"], effects: [{ type: "secondChance", value: 1 }], px: 0.42, py: 0.97 },
];

// Utility nodes (u1-u12) — right region
const UTILITY_NODES: SkillNode[] = [
  { id: "u1", name: "Swiftness I", region: "utility", cost: 1, connections: ["center", "u2", "u3"], effects: [{ type: "moveSpeedPercent", value: 5 }], px: 0.62, py: 0.5 },
  { id: "u2", name: "Collector I", region: "utility", cost: 1, connections: ["u1", "u4", "u5"], effects: [{ type: "pickupRadiusPercent", value: 15 }], px: 0.72, py: 0.42 },
  { id: "u3", name: "Fortune I", region: "utility", cost: 1, connections: ["u1", "u6", "mc2"], effects: [{ type: "dropChancePercent", value: 3 }], px: 0.68, py: 0.58 },
  { id: "u4", name: "Swiftness II", region: "utility", cost: 1, connections: ["u2", "u7"], effects: [{ type: "moveSpeedPercent", value: 8 }], px: 0.8, py: 0.35 },
  { id: "u5", name: "Scholar I", region: "utility", cost: 1, connections: ["u2", "u7", "u8"], effects: [{ type: "xpBonusPercent", value: 10 }], px: 0.78, py: 0.48 },
  { id: "u6", name: "Fortune II", region: "utility", cost: 1, connections: ["u3", "u8", "u9"], effects: [{ type: "dropChancePercent", value: 5 }], px: 0.75, py: 0.65 },
  { id: "u7", name: "Swiftness III", region: "utility", cost: 1, connections: ["u4", "u5", "u10"], effects: [{ type: "moveSpeedPercent", value: 10 }], px: 0.88, py: 0.4 },
  { id: "u8", name: "Lucky Drops", region: "utility", cost: 1, connections: ["u5", "u6", "u10"], effects: [{ type: "dropRarityShift", value: 1 }], px: 0.85, py: 0.55 },
  { id: "u9", name: "War Aura", region: "utility", cost: 1, connections: ["u6", "u11"], effects: [{ type: "allyDamageAuraPercent", value: 10 }], px: 0.78, py: 0.75 },
  { id: "u10", name: "Scholar II", region: "utility", cost: 1, connections: ["u7", "u8", "u11"], effects: [{ type: "xpBonusPercent", value: 15 }], px: 0.92, py: 0.5 },
  { id: "u11", name: "Collector II", region: "utility", cost: 1, connections: ["u9", "u10"], effects: [{ type: "pickupRadiusPercent", value: 30 }], px: 0.9, py: 0.68 },
];

// Major nodes (intersections between regions, cost 2)
const MAJOR_NODES: SkillNode[] = [
  { id: "mc1", name: "Berserker", region: "major", cost: 2, connections: ["c3", "d3"], effects: [{ type: "berserkerDamagePercent", value: 30 }], px: 0.45, py: 0.5 },
  { id: "mc2", name: "Scavenger", region: "major", cost: 2, connections: ["d9", "u3"], effects: [{ type: "dropChancePercent", value: 10 }, { type: "dropRarityShift", value: 1 }], px: 0.6, py: 0.72 },
];

export const ALL_NODES: SkillNode[] = [CENTER, ...COMBAT_NODES, ...DEFENSE_NODES, ...UTILITY_NODES, ...MAJOR_NODES];
export const NODE_MAP = new Map<string, SkillNode>(ALL_NODES.map(n => [n.id, n]));
```

- [ ] **Step 2: Add validation and buff computation functions**

Append to `src/rooms/SkillTree.ts`:

```typescript
export interface SkillBuffs {
  meleeDamagePercent: number;
  rangedDamagePercent: number;
  attackSpeedPercent: number;
  critDamageFlat: number;
  doubleStrikeChance: number;
  vampirismPercent: number;
  maxHpPercent: number;
  hpRegenFlat: number;
  killShieldHp: number;
  damageReductionPercent: number;
  secondChance: boolean;
  moveSpeedPercent: number;
  pickupRadiusPercent: number;
  dropChancePercent: number;
  dropRarityShift: number;
  xpBonusPercent: number;
  allyDamageAuraPercent: number;
  berserkerDamagePercent: number;
}

export function emptyBuffs(): SkillBuffs {
  return {
    meleeDamagePercent: 0, rangedDamagePercent: 0, attackSpeedPercent: 0,
    critDamageFlat: 0, doubleStrikeChance: 0, vampirismPercent: 0,
    maxHpPercent: 0, hpRegenFlat: 0, killShieldHp: 0, damageReductionPercent: 0,
    secondChance: false, moveSpeedPercent: 0, pickupRadiusPercent: 0,
    dropChancePercent: 0, dropRarityShift: 0, xpBonusPercent: 0,
    allyDamageAuraPercent: 0, berserkerDamagePercent: 0,
  };
}

export function computeBuffs(activeNodeIds: string[]): SkillBuffs {
  const buffs = emptyBuffs();
  for (const nodeId of activeNodeIds) {
    const node = NODE_MAP.get(nodeId);
    if (!node) continue;
    for (const effect of node.effects) {
      if (effect.type === "secondChance") {
        buffs.secondChance = true;
      } else {
        (buffs as any)[effect.type] += effect.value;
      }
    }
  }
  return buffs;
}

export function canActivateNode(nodeId: string, activeNodeIds: string[]): { ok: boolean; cost: number; reason?: string } {
  const node = NODE_MAP.get(nodeId);
  if (!node) return { ok: false, cost: 0, reason: "Node not found" };
  if (nodeId === "center") return { ok: false, cost: 0, reason: "Center is always active" };
  if (activeNodeIds.includes(nodeId)) return { ok: false, cost: 0, reason: "Already active" };

  // Must be adjacent to at least one active node
  const hasAdjacentActive = node.connections.some(connId => activeNodeIds.includes(connId));
  if (!hasAdjacentActive) return { ok: false, cost: node.cost, reason: "Not adjacent to active node" };

  return { ok: true, cost: node.cost };
}

export function getTotalCost(activeNodeIds: string[]): number {
  let total = 0;
  for (const nodeId of activeNodeIds) {
    const node = NODE_MAP.get(nodeId);
    if (node && nodeId !== "center") total += node.cost;
  }
  return total;
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: SkillTree.ts compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/rooms/SkillTree.ts
git commit -m "feat: add skill tree with 38 nodes, 3 regions, validation, buff computation"
```

---

### Task 5: Rewrite GameRoom.ts — Wave System, Combat, Drops, Attributes, Skill Tree

**Files:**
- Modify: `src/rooms/GameRoom.ts`

This is the largest task — complete rewrite of the game room to integrate all new systems. The existing file is 226 lines; the new one will be ~500-600 lines.

- [ ] **Step 1: Replace the entire GameRoom.ts**

Rewrite `src/rooms/GameRoom.ts` with the complete new implementation. Key changes from the existing code:

1. **Remove**: `ENEMY_TOUCH_DAMAGE`, `ATTACK_COOLDOWN_MS`, `ATTACK_RANGE` constants (now per-weapon/enemy)
2. **Remove**: `spawnInterval` and `spawnEnemy()` (replaced by wave system)
3. **Remove**: auto stat growth in `killEnemy()` (replaced by attribute system)
4. **Add**: Wave state machine (waiting → combat → pause → combat...)
5. **Add**: Projectile array (server-only, not schema)
6. **Add**: Attack handler that reads weapon type and creates projectiles or melee arcs
7. **Add**: Drop system with TTL and cap
8. **Add**: `allocate_points`, `activate_node`, `reset_tree`, `pickup_item` message handlers
9. **Add**: Enemy AI dispatch using EnemyBehaviors
10. **Add**: Necromancer heal, Creeper explode, Wolf pack bonus logic
11. **Add**: HP regen tick
12. **Add**: Crit calculation
13. **Add**: Skill tree buff application

The full implementation should include:

```typescript
import { Room, type Client } from "colyseus";
import { DroppedItem, Enemy, FloatingText, GameState, Player } from "./GameState.js";
import { type Projectile, WEAPON_DEFS, type WeaponType, computeWeaponDamage, getWeaponCooldown, rollRarity, rollWeaponType } from "./WeaponSystem.js";
import { ENEMY_DEFS, type EnemyTypeName, getAvailableTypes, scaleStats, getEnemyAI, clearEnemyCooldowns, clearAllCooldowns } from "./EnemyBehaviors.js";
import { NODE_MAP, canActivateNode, computeBuffs, getTotalCost, type SkillBuffs, emptyBuffs } from "./SkillTree.js";

const TICK_RATE = 30;
const BASE_PLAYER_SPEED = 180;
const ENEMY_TOUCH_COOLDOWN_MS = 650;
const WAVE_PAUSE_SECONDS = 10;
const SPAWN_BATCH_INTERVAL_MS = 1500;
const DROP_TTL = 30;
const MAX_DROPS = 40;
const MAX_ENEMIES = 80;
const DROP_CHANCE_NORMAL = 0.05;
const PICKUP_RANGE = 40;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class GameRoom extends Room<GameState> {
  state = new GameState();
  maxClients = 32;

  private inputByClient = new Map<string, { x: number; y: number }>();
  private lastAttackAt = new Map<string, number>();
  private lastDamageAt = new Map<string, number>();
  private playerBuffs = new Map<string, SkillBuffs>();
  private secondChanceUsed = new Map<string, boolean>(); // per wave
  private enemySeq = 1;
  private textSeq = 1;
  private dropSeq = 1;
  private projectileSeq = 1;
  private projectiles: Projectile[] = [];

  // Wave system
  private waveEnemyBudget = 0;
  private waveEnemiesSpawned = 0;
  private spawnTimer = 0;
  private waveTimer = 0;

  onCreate() {
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);
    this.registerMessages();
  }

  private registerMessages() {
    this.onMessage("move", (client, payload: { x?: number; y?: number } | undefined) => {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 0;
      const len = Math.hypot(x, y);
      if (len > 0) {
        this.inputByClient.set(client.sessionId, { x: x / len, y: y / len });
      } else {
        this.inputByClient.set(client.sessionId, { x: 0, y: 0 });
      }
    });

    this.onMessage("attack", (client) => this.handleAttack(client));
    this.onMessage("allocate_points", (client, payload) => this.handleAllocatePoints(client, payload));
    this.onMessage("activate_node", (client, payload) => this.handleActivateNode(client, payload));
    this.onMessage("reset_tree", (client) => this.handleResetTree(client));
    this.onMessage("pickup_item", (client, payload) => this.handlePickupItem(client, payload));
  }

  // --- Attack ---
  private handleAttack(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const weaponType = player.equippedWeaponType as WeaponType;
    const def = WEAPON_DEFS[weaponType];
    if (!def) return;

    const now = Date.now();
    const buffs = this.playerBuffs.get(client.sessionId) ?? emptyBuffs();
    const baseCooldown = getWeaponCooldown(weaponType, player.dex);
    const cooldown = Math.round(baseCooldown * (1 - buffs.attackSpeedPercent / 200)); // diminishing returns
    if (now - (this.lastAttackAt.get(client.sessionId) ?? 0) < cooldown) return;
    this.lastAttackAt.set(client.sessionId, now);

    const baseDamage = computeWeaponDamage(weaponType, player.equippedWeaponRarity, { str: player.str, dex: player.dex, intel: player.intel });

    // Crit check
    const critChance = player.critChance / 100;
    const isCrit = Math.random() < critChance;
    const critMultiplier = isCrit ? (2.0 + buffs.critDamageFlat) : 1.0;

    // Category-based damage bonus from skill tree
    let categoryBonus = 0;
    if (def.category === "melee") categoryBonus = buffs.meleeDamagePercent;
    else categoryBonus = buffs.rangedDamagePercent;

    // Berserker check
    let berserkerBonus = 0;
    if (buffs.berserkerDamagePercent > 0 && player.hp / player.maxHp < 0.3) {
      berserkerBonus = buffs.berserkerDamagePercent;
    }

    // Ally damage aura — check if any nearby ally has the aura buff
    let allyAuraBonus = 0;
    for (const [otherId, otherPlayer] of this.state.players) {
      if (otherId === client.sessionId) continue;
      const otherBuffs = this.playerBuffs.get(otherId) ?? emptyBuffs();
      if (otherBuffs.allyDamageAuraPercent > 0 && distance(player, otherPlayer) <= 120) {
        allyAuraBonus = Math.max(allyAuraBonus, otherBuffs.allyDamageAuraPercent);
      }
    }

    const finalDamage = Math.round(baseDamage * critMultiplier * (1 + (categoryBonus + berserkerBonus + allyAuraBonus) / 100));

    const dx = player.lastMoveX || 0;
    const dy = player.lastMoveY || 1;

    if (def.projectileSpeed === 0) {
      // Melee attack
      this.broadcast("swing", { id: client.sessionId, x: player.x, y: player.y, dx, dy });
      this.meleeHit(player, client.sessionId, finalDamage, def, buffs);
    } else if (def.pelletCount) {
      // Shotgun — multiple projectiles in cone
      this.fireShotgun(player, client.sessionId, finalDamage, def, dx, dy);
    } else {
      // Single projectile
      this.fireProjectile(player, client.sessionId, finalDamage, def, dx, dy);
    }

    // Double Strike
    if (buffs.doubleStrikeChance > 0 && Math.random() < buffs.doubleStrikeChance) {
      if (def.projectileSpeed === 0) {
        this.meleeHit(player, client.sessionId, finalDamage, def, buffs);
      } else if (def.pelletCount) {
        this.fireShotgun(player, client.sessionId, finalDamage, def, dx, dy);
      } else {
        this.fireProjectile(player, client.sessionId, finalDamage, def, dx, dy);
      }
    }
  }

  private meleeHit(player: Player, ownerId: string, damage: number, def: typeof WEAPON_DEFS.sword, buffs: SkillBuffs) {
    for (const [enemyId, enemy] of this.state.enemies) {
      if (distance(player, enemy) <= def.range) {
        this.damageEnemy(enemyId, enemy, damage, ownerId, buffs, def.knockback);
      }
    }
  }

  private fireProjectile(player: Player, ownerId: string, damage: number, def: typeof WEAPON_DEFS.bow, dirX: number, dirY: number) {
    const id = `p${this.projectileSeq++}`;

    // For homing projectiles, find nearest enemy as target
    let targetId: string | undefined;
    if (def.homingTurnRate) {
      let bestDist = Infinity;
      for (const [eid, enemy] of this.state.enemies) {
        const d = distance(player, enemy);
        if (d < bestDist) { bestDist = d; targetId = eid; }
      }
    }

    const proj: Projectile = {
      id, x: player.x, y: player.y, dx: dirX, dy: dirY,
      speed: def.projectileSpeed, maxRange: def.range, distanceTraveled: 0,
      damage, ownerId, isEnemy: false,
      aoeRadius: def.aoeRadius, homingTurnRate: def.homingTurnRate, targetId,
    };
    this.projectiles.push(proj);
    this.broadcast("projectile_fired", { id, type: def.type, x: player.x, y: player.y, dx: dirX, dy: dirY, speed: def.projectileSpeed, isEnemy: false });
  }

  private fireShotgun(player: Player, ownerId: string, damagePerPellet: number, def: typeof WEAPON_DEFS.shotgun, dirX: number, dirY: number) {
    const baseAngle = Math.atan2(dirY, dirX);
    const count = def.pelletCount!;
    const cone = def.coneAngle!;
    for (let i = 0; i < count; i++) {
      const angle = baseAngle - cone / 2 + (cone / (count - 1)) * i;
      const pdx = Math.cos(angle);
      const pdy = Math.sin(angle);
      const id = `p${this.projectileSeq++}`;
      const proj: Projectile = {
        id, x: player.x, y: player.y, dx: pdx, dy: pdy,
        speed: def.projectileSpeed, maxRange: def.range, distanceTraveled: 0,
        damage: damagePerPellet, ownerId, isEnemy: false,
      };
      this.projectiles.push(proj);
      this.broadcast("projectile_fired", { id, type: "shotgun", x: player.x, y: player.y, dx: pdx, dy: pdy, speed: def.projectileSpeed, isEnemy: false });
    }
  }

  private damageEnemy(enemyId: string, enemy: Enemy, damage: number, killerId: string, buffs: SkillBuffs, knockback?: number) {
    enemy.hp -= damage;
    this.spawnFloatingText(`-${damage}`, enemy.x, enemy.y - 12);

    // Knockback
    if (knockback && knockback > 0) {
      const player = this.state.players.get(killerId);
      if (player) {
        const dx = enemy.x - player.x;
        const dy = enemy.y - player.y;
        const len = Math.hypot(dx, dy) || 1;
        const kb = enemy.enemyType === "golem" ? knockback * 0.5 : knockback;
        enemy.x += (dx / len) * kb;
        enemy.y += (dy / len) * kb;
      }
    }

    // Vampirism
    if (buffs.vampirismPercent > 0) {
      const player = this.state.players.get(killerId);
      if (player) {
        const heal = Math.round(damage * buffs.vampirismPercent / 100);
        player.hp = Math.min(player.maxHp, player.hp + heal);
      }
    }

    if (enemy.hp <= 0) {
      const killer = this.state.players.get(killerId);
      if (killer) this.killEnemy(enemyId, killer);
    }
  }

  // --- Attribute allocation ---
  private handleAllocatePoints(client: Client, payload: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const str = Math.floor(Number(payload?.str) || 0);
    const dex = Math.floor(Number(payload?.dex) || 0);
    const vit = Math.floor(Number(payload?.vit) || 0);
    const intel = Math.floor(Number(payload?.intel) || 0);
    const lck = Math.floor(Number(payload?.lck) || 0);
    const total = str + dex + vit + intel + lck;
    if (total <= 0 || total > player.unspentPoints) return;
    if (str < 0 || dex < 0 || vit < 0 || intel < 0 || lck < 0) return;

    player.str += str;
    player.dex += dex;
    player.vit += vit;
    player.intel += intel;
    player.lck += lck;
    player.unspentPoints -= total;
    this.recomputeDerivedStats(player);
  }

  // --- Skill tree ---
  private handleActivateNode(client: Client, payload: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const nodeId = payload?.nodeId;
    if (!nodeId) return;

    const activeIds = [...player.activeSkillNodes];
    const result = canActivateNode(nodeId, activeIds);
    if (!result.ok) return;
    if (player.perkPoints < result.cost) return;

    player.perkPoints -= result.cost;
    player.activeSkillNodes.push(nodeId);
    this.recomputeBuffs(client.sessionId, player);
    this.recomputeDerivedStats(player);
  }

  private handleResetTree(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const refund = getTotalCost([...player.activeSkillNodes]);
    player.activeSkillNodes.clear();
    player.activeSkillNodes.push("center");
    player.perkPoints += refund;
    this.recomputeBuffs(client.sessionId, player);
    this.recomputeDerivedStats(player);

    // Clamp HP
    if (player.hp > player.maxHp) player.hp = player.maxHp;
    if (player.hp < 1) player.hp = 1;
  }

  // --- Item pickup ---
  private handlePickupItem(client: Client, payload: any) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const itemId = payload?.itemId;
    if (!itemId) return;

    const item = this.state.droppedItems.get(itemId);
    if (!item) return;
    const buffs = this.playerBuffs.get(client.sessionId) ?? emptyBuffs();
    const pickupRange = PICKUP_RANGE * (1 + buffs.pickupRadiusPercent / 100);
    if (distance(player, item) > pickupRange) return;

    player.equippedWeaponType = item.weaponType;
    player.equippedWeaponRarity = item.weaponRarity;
    this.state.droppedItems.delete(itemId);
  }

  // --- Derived stats ---
  private recomputeBuffs(sessionId: string, player: Player) {
    const buffs = computeBuffs([...player.activeSkillNodes]);
    this.playerBuffs.set(sessionId, buffs);
  }

  private recomputeDerivedStats(player: Player) {
    const buffs = this.playerBuffs.get(player.id) ?? emptyBuffs();
    const baseMaxHp = 100 + player.vit * 10;
    player.maxHp = Math.round(baseMaxHp * (1 + buffs.maxHpPercent / 100));
    player.moveSpeed = Math.round(BASE_PLAYER_SPEED * (1 + buffs.moveSpeedPercent / 100));
    player.critChance = player.lck * 0.5; // stored as percentage
    player.hpRegen = player.vit * 0.2 + buffs.hpRegenFlat;
  }

  // --- Join / Leave ---
  onJoin(client: Client, options: { name?: string }) {
    const player = new Player();
    player.id = client.sessionId;
    player.name = String(options?.name || `Player ${this.clients.length}`);
    player.x = 300 + Math.random() * 1000;
    player.y = 250 + Math.random() * 700;
    player.activeSkillNodes.push("center");

    this.state.players.set(client.sessionId, player);
    this.inputByClient.set(client.sessionId, { x: 0, y: 0 });
    this.playerBuffs.set(client.sessionId, emptyBuffs());

    // Start wave system if first player
    if (this.state.players.size === 1 && this.state.wave.state === "waiting") {
      this.startWavePause();
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.inputByClient.delete(client.sessionId);
    this.lastAttackAt.delete(client.sessionId);
    this.playerBuffs.delete(client.sessionId);
    this.secondChanceUsed.delete(client.sessionId);
    for (const key of [...this.lastDamageAt.keys()]) {
      if (key.startsWith(`${client.sessionId}:`)) this.lastDamageAt.delete(key);
    }
  }

  onDispose() {}

  // --- Main update loop ---
  private update(deltaTime: number) {
    const dt = deltaTime / 1000;
    const now = Date.now();

    this.updateWave(dt, now);
    this.updatePlayers(dt);
    this.updateEnemies(dt, now);
    this.updateProjectiles(dt, now);
    this.updateDrops(dt);
    this.updateFloatingTexts(dt);
    this.updateHpRegen(dt);
  }

  // --- Wave state machine ---
  private updateWave(dt: number, now: number) {
    const wave = this.state.wave;
    if (this.state.players.size === 0) return;

    if (wave.state === "pause") {
      wave.timer -= dt;
      if (wave.timer <= 0) {
        this.startWaveCombat();
      }
    } else if (wave.state === "combat") {
      // Spawn enemies in batches
      this.spawnTimer += dt * 1000;
      if (this.spawnTimer >= SPAWN_BATCH_INTERVAL_MS && this.waveEnemiesSpawned < this.waveEnemyBudget) {
        this.spawnTimer = 0;
        const batchSize = Math.min(4 + Math.floor(Math.random() * 3), this.waveEnemyBudget - this.waveEnemiesSpawned, MAX_ENEMIES - this.state.enemies.size);
        for (let i = 0; i < batchSize; i++) {
          this.spawnWaveEnemy();
        }
      }

      // Check wave complete
      wave.enemiesRemaining = (this.waveEnemyBudget - this.waveEnemiesSpawned) + this.state.enemies.size;
      if (wave.enemiesRemaining <= 0) {
        this.completeWave();
      }
    }
  }

  private startWavePause() {
    const wave = this.state.wave;
    wave.state = "pause";
    wave.timer = WAVE_PAUSE_SECONDS;
    this.secondChanceUsed.clear();
  }

  private startWaveCombat() {
    const wave = this.state.wave;
    wave.waveNumber++;
    wave.state = "combat";
    wave.timer = 0;
    this.waveEnemyBudget = Math.min(5 + wave.waveNumber * 2, 200);
    this.waveEnemiesSpawned = 0;
    this.spawnTimer = SPAWN_BATCH_INTERVAL_MS; // spawn first batch immediately
    clearAllCooldowns();

    this.broadcast("wave_start", { waveNumber: wave.waveNumber, enemyCount: this.waveEnemyBudget });

    // Boss wave
    if (wave.waveNumber % 5 === 0) {
      this.spawnBoss();
    }
  }

  private completeWave() {
    this.broadcast("wave_complete", { waveNumber: this.state.wave.waveNumber, nextWaveIn: WAVE_PAUSE_SECONDS });
    this.startWavePause();
  }

  private spawnWaveEnemy() {
    if (this.state.enemies.size >= MAX_ENEMIES) return;
    const waveNum = this.state.wave.waveNumber;
    const available = getAvailableTypes(waveNum);
    const typeName = available[Math.floor(Math.random() * available.length)];
    this.spawnEnemyOfType(typeName, false);
    this.waveEnemiesSpawned++;
  }

  private spawnBoss() {
    const waveNum = this.state.wave.waveNumber;
    const available = getAvailableTypes(waveNum);
    const typeName = available[Math.floor(Math.random() * available.length)];
    const enemy = this.spawnEnemyOfType(typeName, true);
    if (enemy) {
      this.broadcast("boss_spawn", { enemyId: enemy.id, enemyType: typeName });
    }
  }

  private spawnEnemyOfType(typeName: EnemyTypeName, isBoss: boolean): Enemy | null {
    const def = ENEMY_DEFS[typeName];
    const waveNum = this.state.wave.waveNumber;
    const scaled = scaleStats(def, waveNum, isBoss);

    const enemy = new Enemy();
    enemy.id = `e${this.enemySeq++}`;
    enemy.enemyType = typeName;
    enemy.isBoss = isBoss;
    enemy.hp = scaled.hp;
    enemy.maxHp = scaled.hp;
    enemy.damage = scaled.damage;
    enemy.speed = scaled.speed;
    enemy.xpReward = scaled.xpReward;

    // Spawn at random edge
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) { enemy.x = Math.random() * this.state.worldWidth; enemy.y = 20; }
    else if (edge === 1) { enemy.x = Math.random() * this.state.worldWidth; enemy.y = this.state.worldHeight - 20; }
    else if (edge === 2) { enemy.x = 20; enemy.y = Math.random() * this.state.worldHeight; }
    else { enemy.x = this.state.worldWidth - 20; enemy.y = Math.random() * this.state.worldHeight; }

    this.state.enemies.set(enemy.id, enemy);
    return enemy;
  }

  // --- Player update ---
  private updatePlayers(dt: number) {
    for (const [id, player] of this.state.players) {
      const input = this.inputByClient.get(id) ?? { x: 0, y: 0 };
      player.x = clamp(player.x + input.x * player.moveSpeed * dt, 24, this.state.worldWidth - 24);
      player.y = clamp(player.y + input.y * player.moveSpeed * dt, 24, this.state.worldHeight - 24);
      if (input.x !== 0 || input.y !== 0) {
        player.lastMoveX = input.x;
        player.lastMoveY = input.y;
      }
    }
  }

  // --- Enemy AI update ---
  private updateEnemies(dt: number, now: number) {
    const playersArr = [...this.state.players.values()];
    const enemiesArr = [...this.state.enemies.values()];
    const enemiesToDelete: string[] = [];

    for (const [enemyId, enemy] of this.state.enemies) {
      const action = getEnemyAI(enemy, playersArr, enemiesArr, now);

      // Movement
      enemy.x = clamp(enemy.x + action.moveX * enemy.speed * dt, 0, this.state.worldWidth);
      enemy.y = clamp(enemy.y + action.moveY * enemy.speed * dt, 0, this.state.worldHeight);

      // Touch damage for melee enemies
      for (const player of playersArr) {
        if (distance(enemy, player) < 30) {
          const key = `${player.id}:${enemy.id}`;
          if (now - (this.lastDamageAt.get(key) ?? 0) >= ENEMY_TOUCH_COOLDOWN_MS) {
            this.lastDamageAt.set(key, now);
            let dmg = enemy.damage;
            // Wolf pack bonus
            if (enemy.enemyType === "wolf" && !enemy.isBoss) {
              const nearbyWolves = enemiesArr.filter(e => e.id !== enemy.id && e.enemyType === "wolf" && distance(e, enemy) <= 80).length;
              if (nearbyWolves > 0) dmg = Math.round(dmg * 1.2);
            }
            this.damagePlayer(player, dmg);
          }
        }
      }

      // Ranged attack (creates enemy projectile)
      if (action.shoot) {
        const s = action.shoot;
        const projId = `ep${this.projectileSeq++}`;
        this.projectiles.push({
          id: projId, x: enemy.x, y: enemy.y, dx: s.dx, dy: s.dy,
          speed: s.speed, maxRange: s.maxRange, distanceTraveled: 0,
          damage: s.damage, ownerId: enemy.id, isEnemy: true,
          homingTurnRate: s.homingTurnRate, targetId: s.targetId,
        });
        this.broadcast("projectile_fired", { id: projId, type: enemy.enemyType, x: enemy.x, y: enemy.y, dx: s.dx, dy: s.dy, speed: s.speed, isEnemy: true });
      }

      // Necromancer heal
      if (action.heal) {
        for (const other of enemiesArr) {
          if (other.id === enemy.id) continue; // can't heal self
          if (other.isBoss) continue; // can't heal bosses
          if (distance(enemy, other) <= action.heal.radius && other.hp < other.maxHp) {
            other.hp = Math.min(other.maxHp, other.hp + action.heal.amount);
          }
        }
      }

      // Creeper explosion
      if (action.explode) {
        this.broadcast("explosion", { x: enemy.x, y: enemy.y, radius: action.explode.radius });
        for (const player of playersArr) {
          if (distance(enemy, player) <= action.explode.radius) {
            this.damagePlayer(player, action.explode.damage);
          }
        }
        enemiesToDelete.push(enemyId);
        clearEnemyCooldowns(enemyId);
      }

      // Boss creeper slam
      if (action.slam) {
        this.broadcast("explosion", { x: enemy.x, y: enemy.y, radius: action.slam.radius });
        for (const player of playersArr) {
          if (distance(enemy, player) <= action.slam.radius) {
            this.damagePlayer(player, action.slam.damage);
          }
        }
      }
    }

    // Deferred deletion (creeper explosions)
    for (const eid of enemiesToDelete) {
      this.state.enemies.delete(eid);
    }
  }

  private damagePlayer(player: Player, rawDamage: number) {
    const buffs = this.playerBuffs.get(player.id) ?? emptyBuffs();
    const damage = Math.round(rawDamage * (1 - buffs.damageReductionPercent / 100));
    player.hp = Math.max(0, player.hp - damage);
    this.spawnFloatingText(`-${damage}`, player.x, player.y - 16);

    if (player.hp <= 0) {
      // Second Chance check
      if (buffs.secondChance && !this.secondChanceUsed.get(player.id)) {
        this.secondChanceUsed.set(player.id, true);
        player.hp = Math.round(player.maxHp * 0.5);
        this.spawnFloatingText("SECOND CHANCE!", player.x, player.y - 32);
        return;
      }

      // Normal death: respawn with XP penalty
      player.hp = player.maxHp;
      player.x = 300 + Math.random() * 1000;
      player.y = 250 + Math.random() * 700;
      player.xp = Math.max(0, player.xp - 20);
      this.broadcast("player_died", { id: player.id });
    }
  }

  // --- Projectile update ---
  private updateProjectiles(dt: number, now: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      const moveStep = proj.speed * dt;

      // Homing
      if (proj.homingTurnRate && proj.targetId) {
        const target = proj.isEnemy
          ? this.state.players.get(proj.targetId)
          : this.state.enemies.get(proj.targetId);
        if (target) {
          const toDirX = target.x - proj.x;
          const toDirY = target.y - proj.y;
          const toLen = Math.hypot(toDirX, toDirY) || 1;
          const desiredAngle = Math.atan2(toDirY / toLen, toDirX / toLen);
          const currentAngle = Math.atan2(proj.dy, proj.dx);
          let angleDiff = desiredAngle - currentAngle;
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          const maxTurn = proj.homingTurnRate * dt;
          const turn = clamp(angleDiff, -maxTurn, maxTurn);
          const newAngle = currentAngle + turn;
          proj.dx = Math.cos(newAngle);
          proj.dy = Math.sin(newAngle);
        }
      }

      proj.x += proj.dx * moveStep;
      proj.y += proj.dy * moveStep;
      proj.distanceTraveled += moveStep;

      // Out of bounds or max range
      if (proj.distanceTraveled >= proj.maxRange || proj.x < 0 || proj.x > this.state.worldWidth || proj.y < 0 || proj.y > this.state.worldHeight) {
        this.broadcast("projectile_hit", { id: proj.id });
        this.projectiles.splice(i, 1);
        continue;
      }

      // Hit detection
      let hit = false;
      if (proj.isEnemy) {
        // Enemy projectile hits players
        for (const player of this.state.players.values()) {
          if (distance(proj, player) < 20) {
            this.damagePlayer(player, proj.damage);
            hit = true;
            break;
          }
        }
      } else {
        // Player projectile hits enemies
        const buffs = this.playerBuffs.get(proj.ownerId) ?? emptyBuffs();
        if (proj.aoeRadius) {
          // AoE: check center hit, then damage all in radius
          for (const [enemyId, enemy] of this.state.enemies) {
            if (distance(proj, enemy) < 20) {
              // Explode on contact
              for (const [eid2, e2] of this.state.enemies) {
                if (distance(proj, e2) <= proj.aoeRadius) {
                  this.damageEnemy(eid2, e2, proj.damage, proj.ownerId, buffs);
                }
              }
              hit = true;
              break;
            }
          }
        } else {
          for (const [enemyId, enemy] of this.state.enemies) {
            if (distance(proj, enemy) < 20) {
              this.damageEnemy(enemyId, enemy, proj.damage, proj.ownerId, buffs);
              hit = true;
              break;
            }
          }
        }
      }

      if (hit) {
        this.broadcast("projectile_hit", { id: proj.id });
        this.projectiles.splice(i, 1);
      }
    }
  }

  // --- Drop system ---
  private updateDrops(dt: number) {
    for (const [id, item] of this.state.droppedItems) {
      item.ttl -= dt;
      if (item.ttl <= 0) {
        this.state.droppedItems.delete(id);
      }
    }
  }

  private spawnDrop(x: number, y: number, isBoss: boolean, killerId: string) {
    const waveNum = this.state.wave.waveNumber;
    const killer = this.state.players.get(killerId);
    const killerLck = killer?.lck ?? 0;
    const buffs = this.playerBuffs.get(killerId) ?? emptyBuffs();
    const dropChance = isBoss ? 1.0 : (DROP_CHANCE_NORMAL + buffs.dropChancePercent / 100);
    if (Math.random() > dropChance) return;

    // Enforce max drops
    if (this.state.droppedItems.size >= MAX_DROPS) {
      // Remove oldest
      const firstKey = this.state.droppedItems.keys().next().value;
      if (firstKey) this.state.droppedItems.delete(firstKey);
    }

    const item = new DroppedItem();
    item.id = `d${this.dropSeq++}`;
    item.x = x;
    item.y = y;
    item.weaponType = rollWeaponType();
    let rarity = rollRarity(isBoss, waveNum, killerLck);
    // Apply skill tree rarity shift
    rarity = Math.min(4, rarity + buffs.dropRarityShift);
    item.weaponRarity = rarity;
    item.ttl = DROP_TTL;
    this.state.droppedItems.set(item.id, item);
  }

  // --- Kill enemy ---
  private killEnemy(enemyId: string, killer: Player) {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy) return;

    const buffs = this.playerBuffs.get(killer.id) ?? emptyBuffs();
    const xpBonus = 1 + buffs.xpBonusPercent / 100;
    const xpGain = Math.round(enemy.xpReward * xpBonus);

    killer.xp += xpGain;
    this.spawnFloatingText(`+${xpGain} XP`, killer.x, killer.y - 30);

    // Kill Shield
    if (buffs.killShieldHp > 0) {
      killer.hp = Math.min(killer.maxHp, killer.hp + buffs.killShieldHp);
    }

    // Drop
    this.spawnDrop(enemy.x, enemy.y, enemy.isBoss, killer.id);

    this.state.enemies.delete(enemyId);
    clearEnemyCooldowns(enemyId);

    // Level up
    while (killer.xp >= killer.xpToNext && killer.level < 100) {
      killer.xp -= killer.xpToNext;
      killer.level += 1;
      killer.unspentPoints += 3;
      killer.xpToNext = Math.round(killer.xpToNext * 1.45);
      this.spawnFloatingText(`LEVEL ${killer.level}!`, killer.x, killer.y - 48);
      this.broadcast("level_up", { id: killer.id, level: killer.level });

      // Perk point every 5 levels
      if (killer.level % 5 === 0) {
        killer.perkPoints += 1;
        this.broadcast("perk_available", { id: killer.id, level: killer.level });
      }
    }
  }

  // --- HP Regen ---
  private hpRegenAccumulator = new Map<string, number>();
  private updateHpRegen(dt: number) {
    for (const [id, player] of this.state.players) {
      if (player.hpRegen > 0 && player.hp < player.maxHp && player.hp > 0) {
        const acc = (this.hpRegenAccumulator.get(id) ?? 0) + player.hpRegen * dt;
        const whole = Math.floor(acc);
        if (whole >= 1) {
          player.hp = Math.min(player.maxHp, player.hp + whole);
          this.hpRegenAccumulator.set(id, acc - whole);
        } else {
          this.hpRegenAccumulator.set(id, acc);
        }
      }
    }
  }

  // --- Floating text ---
  private updateFloatingTexts(dt: number) {
    for (const [id, text] of this.state.floatingTexts) {
      text.y -= 18 * dt;
      text.ttl -= dt;
      if (text.ttl <= 0) this.state.floatingTexts.delete(id);
    }
  }

  private spawnFloatingText(text: string, x: number, y: number) {
    const ft = new FloatingText();
    ft.id = `t${this.textSeq++}`;
    ft.text = text;
    ft.x = x;
    ft.y = y;
    ft.ttl = 0.85;
    this.state.floatingTexts.set(ft.id, ft);
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Start server and verify basic functionality**

Run: `npx tsx src/server.ts`
Expected: Server starts, `HTTP + client em http://localhost:2567` appears.
Open browser, verify: player spawns, wave countdown starts, enemies spawn, melee attack works with sword.

- [ ] **Step 4: Commit**

```bash
git add src/rooms/GameRoom.ts
git commit -m "feat: rewrite game room with wave system, combat, drops, attributes, skill tree"
```

---

## Phase 2: Client Update

### Task 6: Client — Enemy Type Visuals and Wave HUD

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace `makeEnemy()` with type-aware version**

Replace the existing `makeEnemy()` function with one that takes `enemyType` and `isBoss` parameters and draws different colored shapes per type:

```javascript
const ENEMY_COLORS = {
  slime: 0x6bff6b,      // green
  skeleton: 0xd4d4d4,    // gray
  archer: 0x8b5e3c,      // brown
  wolf: 0x888888,        // dark gray
  golem: 0x8b7355,       // stone brown
  necromancer: 0x9b59b6, // purple
  creeper: 0xff4444,     // bright red
  sorcerer: 0x3498db,    // blue
};

function makeEnemy(enemyType, isBoss) {
  const c = new Container();
  const color = ENEMY_COLORS[enemyType] || 0xff6b6b;
  const scale = isBoss ? 1.5 : 1;
  c.scale.set(scale);

  let body;
  switch (enemyType) {
    case "slime":
      body = new Graphics().ellipse(0, 2, 14, 10).fill(color).circle(-4, -2, 2).fill(0xffffff).circle(4, -2, 2).fill(0xffffff);
      break;
    case "skeleton":
      body = new Graphics().rect(-6, -14, 12, 28).fill(color).circle(-3, -8, 2).fill(0x333333).circle(3, -8, 2).fill(0x333333);
      break;
    case "archer":
      body = new Graphics().rect(-6, -14, 12, 28).fill(color).rect(8, -10, 3, 20).fill(0x654321);
      break;
    case "wolf":
      body = new Graphics().ellipse(0, 0, 16, 10).fill(color).moveTo(14, -4).lineTo(22, -8).lineTo(14, 0).fill(color);
      break;
    case "golem":
      body = new Graphics().roundRect(-16, -16, 32, 32, 4).fill(color);
      break;
    case "necromancer":
      body = new Graphics().moveTo(0, -16).lineTo(12, 12).lineTo(-12, 12).closePath().fill(color).circle(0, -4, 3).fill(0x00ff00);
      break;
    case "creeper":
      body = new Graphics().roundRect(-10, -14, 20, 28, 6).fill(color).circle(-3, -6, 2).fill(0x000000).circle(3, -6, 2).fill(0x000000);
      break;
    case "sorcerer":
      body = new Graphics().circle(0, 0, 12).fill(color).circle(0, -14, 6).fill(0x2980b9);
      break;
    default:
      body = new Graphics().roundRect(-14, -12, 28, 24, 8).fill(color);
  }

  const hpBg = new Graphics().rect(-18, -24, 36, 4).fill(0x000000, 0.45);
  const hpFillBar = new Graphics();
  c.addChild(body, hpBg, hpFillBar);
  c._hpFillBar = hpFillBar;
  return c;
}
```

- [ ] **Step 2: Update onAdd("enemies") to pass enemy type**

Update the enemy onAdd callback to pass `enemyType` and `isBoss`:

```javascript
$.onAdd("enemies", (enemy, id) => {
  const sprite = makeEnemy(enemy.enemyType, enemy.isBoss);
  world.addChild(sprite);
  enemies.set(id, sprite);
  updateEnemyBar(sprite, enemy);
  sprite.x = enemy.x;
  sprite.y = enemy.y;

  $.onChange(enemy, () => {
    sprite.x = enemy.x;
    sprite.y = enemy.y;
    updateEnemyBar(sprite, enemy);
  });
});
```

- [ ] **Step 3: Add wave HUD elements to HTML**

Add to the HUD div:
```html
<div style="margin-top:8px; border-top: 1px solid rgba(255,255,255,.15); padding-top: 8px;">
  <div>Wave: <b id="waveText">0</b> <span id="waveStateText" style="color:#888"></span></div>
  <div>Timer: <b id="waveTimerText">-</b></div>
  <div>Restantes: <b id="enemiesRemainingText">0</b></div>
</div>
```

Add DOM element references in JS:
```javascript
const waveText = document.getElementById("waveText");
const waveStateText = document.getElementById("waveStateText");
const waveTimerText = document.getElementById("waveTimerText");
const enemiesRemainingText = document.getElementById("enemiesRemainingText");
```

- [ ] **Step 4: Update the game loop to display wave info**

In the ticker, add wave state display:
```javascript
// Wave HUD
const wave = room.state.wave;
if (wave) {
  waveText.textContent = String(wave.waveNumber);
  waveStateText.textContent = wave.state === "pause" ? "(pausa)" : wave.state === "combat" ? "(combate)" : "";
  waveTimerText.textContent = wave.state === "pause" ? `${Math.ceil(wave.timer)}s` : "-";
  enemiesRemainingText.textContent = String(wave.enemiesRemaining);
}
```

- [ ] **Step 5: Add wave_start, wave_complete, boss_spawn message handlers**

```javascript
room.onMessage("wave_start", ({ waveNumber, enemyCount }) => {
  showToast(`WAVE ${waveNumber} — ${enemyCount} inimigos`);
});

room.onMessage("wave_complete", ({ waveNumber }) => {
  showToast(`WAVE ${waveNumber} COMPLETA!`);
});

room.onMessage("boss_spawn", ({ enemyType }) => {
  showToast(`BOSS: ${enemyType.toUpperCase()}!`);
});
```

- [ ] **Step 6: Verify in browser**

Run server, open browser. Verify: wave countdown shows, wave starts, enemies appear with different colors per type, wave HUD updates, boss appears at wave 5 with 1.5x size.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: client enemy type visuals, wave HUD, wave messages"
```

---

### Task 7: Client — Projectiles, Explosions, Dropped Items

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add projectile rendering system**

Add a `clientProjectiles` map and handler for `projectile_fired` / `projectile_hit`:

```javascript
const clientProjectiles = new Map();

const PROJECTILE_COLORS = {
  bow: 0xc28b2c,
  staff: 0x9b59b6,
  pistol: 0xffff00,
  shotgun: 0xff8800,
  arcaneOrb: 0x00ffcc,
  archer: 0x8b5e3c,
  sorcerer: 0x3498db,
};

room.onMessage("projectile_fired", ({ id, type, x, y, dx, dy, speed, isEnemy }) => {
  const g = new Graphics();
  const color = PROJECTILE_COLORS[type] || (isEnemy ? 0xff4444 : 0xffff00);
  g.circle(0, 0, isEnemy ? 4 : 5).fill(color);
  g.x = x; g.y = y;
  g._dx = dx; g._dy = dy; g._speed = speed;
  g._life = 3; // max 3 seconds
  world.addChild(g);
  clientProjectiles.set(id, g);
});

room.onMessage("projectile_hit", ({ id }) => {
  const g = clientProjectiles.get(id);
  if (g) { world.removeChild(g); clientProjectiles.delete(id); }
});
```

- [ ] **Step 2: Update ticker to move client projectiles**

In the ticker loop, before the effects cleanup:

```javascript
// Update client projectiles
for (const [id, g] of clientProjectiles) {
  g.x += g._dx * g._speed * dt;
  g.y += g._dy * g._speed * dt;
  g._life -= dt;
  if (g._life <= 0) {
    world.removeChild(g);
    clientProjectiles.delete(id);
  }
}
```

- [ ] **Step 3: Add explosion visual handler**

```javascript
room.onMessage("explosion", ({ x, y, radius }) => {
  const g = new Graphics();
  g.circle(x, y, radius).fill({ color: 0xff4400, alpha: 0.4 });
  g.circle(x, y, radius * 0.6).fill({ color: 0xffaa00, alpha: 0.5 });
  g.life = 0.3;
  world.addChild(g);
  effects.push(g);
});
```

- [ ] **Step 4: Add dropped item rendering**

```javascript
const RARITY_COLORS_HEX = [0xffffff, 0x4ade80, 0x60a5fa, 0xc084fc, 0xfbbf24];
const droppedItems = new Map();

$.onAdd("droppedItems", (item, id) => {
  const c = new Container();
  const color = RARITY_COLORS_HEX[item.weaponRarity] || 0xffffff;
  // Glow
  const glow = new Graphics().circle(0, 0, 14).fill({ color, alpha: 0.25 });
  // Item dot
  const dot = new Graphics().roundRect(-6, -6, 12, 12, 3).fill(color);
  c.addChild(glow, dot);
  c.x = item.x; c.y = item.y;
  world.addChild(c);
  droppedItems.set(id, c);
});

$.onRemove("droppedItems", (_, id) => {
  const c = droppedItems.get(id);
  if (c) { world.removeChild(c); droppedItems.delete(id); }
});
```

- [ ] **Step 5: Add pickup key handler (E key)**

In the ticker, after the attack key check:

```javascript
if (keys["e"]) {
  if (!keys._pickupSent) {
    keys._pickupSent = true;
    // Find nearest dropped item
    if (me && room.state.droppedItems) {
      let nearestId = null, nearestDist = 50; // 50px pickup range on client
      room.state.droppedItems.forEach((item, id) => {
        const d = Math.hypot(item.x - me.x, item.y - me.y);
        if (d < nearestDist) { nearestDist = d; nearestId = id; }
      });
      if (nearestId) room.send("pickup_item", { itemId: nearestId });
    }
  }
} else {
  keys._pickupSent = false;
}
```

- [ ] **Step 6: Add weapon display to HUD**

Add to HUD HTML:
```html
<div>Arma: <b id="weaponText">Sword</b></div>
```

In JS, add DOM ref and update in ticker:
```javascript
const weaponText = document.getElementById("weaponText");
// In ticker, after `if (me)`:
const RARITY_CSS = ["#fff", "#4ade80", "#60a5fa", "#c084fc", "#fbbf24"];
const RARITY_NAMES = ["", "Uncommon ", "Rare ", "Epic ", "Legendary "];
weaponText.textContent = `${RARITY_NAMES[me.equippedWeaponRarity]}${me.equippedWeaponType}`;
weaponText.style.color = RARITY_CSS[me.equippedWeaponRarity];
```

- [ ] **Step 7: Update controls help text**

Update the HUD instructions:
```html
<div><b>WASD / setas</b> para mover</div>
<div><b>Espaço</b> para atacar</div>
<div><b>E</b> para coletar item</div>
```

- [ ] **Step 8: Verify in browser**

Test: ranged weapons fire projectiles, explosions show for creeper, drops appear on ground with colored glow, E key picks up items, weapon display shows in HUD.

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: client projectiles, explosions, dropped items, weapon HUD"
```

---

### Task 8: Client — Attribute Distribution UI

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add attribute panel HTML**

Add after the error div:
```html
<div id="attrPanel" style="display:none; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); z-index:20; background:rgba(0,0,0,.85); border:1px solid rgba(255,255,255,.2); border-radius:16px; padding:20px 28px; color:#fff; font:14px/1.6 system-ui,sans-serif; min-width:280px; backdrop-filter:blur(8px);">
  <div style="font-size:18px;font-weight:700;margin-bottom:12px">Distribuir Pontos <span id="attrAvail" style="color:#58a6ff"></span></div>
  <div class="attr-row" data-attr="str">STR (Forca): <span id="attrStr">0</span> <button data-d="str">+</button></div>
  <div class="attr-row" data-attr="dex">DEX (Destreza): <span id="attrDex">0</span> <button data-d="dex">+</button></div>
  <div class="attr-row" data-attr="vit">VIT (Vitalidade): <span id="attrVit">0</span> <button data-d="vit">+</button></div>
  <div class="attr-row" data-attr="intel">INT (Inteligencia): <span id="attrInt">0</span> <button data-d="intel">+</button></div>
  <div class="attr-row" data-attr="lck">LCK (Sorte): <span id="attrLck">0</span> <button data-d="lck">+</button></div>
  <div style="margin-top:12px;text-align:center">
    <button id="attrConfirm" style="padding:6px 16px;border-radius:8px;background:#58a6ff;color:#000;border:none;font-weight:700;cursor:pointer">Confirmar</button>
    <button id="attrClose" style="padding:6px 16px;border-radius:8px;background:#333;color:#fff;border:none;cursor:pointer;margin-left:8px">Fechar</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for attribute buttons**

Add to the style block:
```css
.attr-row { margin: 4px 0; display: flex; align-items: center; gap: 8px; }
.attr-row button { width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.1); color: #fff; cursor: pointer; font-size: 16px; }
.attr-row button:hover { background: rgba(255,255,255,.2); }
```

- [ ] **Step 3: Add attribute panel JS logic**

```javascript
const attrPanel = document.getElementById("attrPanel");
const attrAvail = document.getElementById("attrAvail");
const attrConfirm = document.getElementById("attrConfirm");
const attrClose = document.getElementById("attrClose");
const pending = { str: 0, dex: 0, vit: 0, intel: 0, lck: 0 };
let attrPointsLeft = 0;

function showAttrPanel() {
  const me = room.state.players?.get(room.sessionId);
  if (!me || me.unspentPoints <= 0) return;
  Object.keys(pending).forEach(k => pending[k] = 0);
  attrPointsLeft = me.unspentPoints;
  updateAttrDisplay(me);
  attrPanel.style.display = "block";
}

function updateAttrDisplay(me) {
  document.getElementById("attrStr").textContent = me.str + pending.str;
  document.getElementById("attrDex").textContent = me.dex + pending.dex;
  document.getElementById("attrVit").textContent = me.vit + pending.vit;
  document.getElementById("attrInt").textContent = me.intel + pending.intel;
  document.getElementById("attrLck").textContent = me.lck + pending.lck;
  const spent = Object.values(pending).reduce((a, b) => a + b, 0);
  attrAvail.textContent = `(${me.unspentPoints - spent} disponiveis)`;
}

attrPanel.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-d]");
  if (!btn) return;
  const attr = btn.dataset.d;
  const spent = Object.values(pending).reduce((a, b) => a + b, 0);
  const me = room.state.players?.get(room.sessionId);
  if (!me || spent >= me.unspentPoints) return;
  pending[attr]++;
  updateAttrDisplay(me);
});

attrConfirm.addEventListener("click", () => {
  const total = Object.values(pending).reduce((a, b) => a + b, 0);
  if (total > 0) room.send("allocate_points", { ...pending });
  attrPanel.style.display = "none";
});

attrClose.addEventListener("click", () => {
  attrPanel.style.display = "none";
});

// Show on level up
room.onMessage("level_up", ({ id, level }) => {
  if (id === room.sessionId) {
    showToast(`LEVEL UP -> ${level}`);
    setTimeout(() => showAttrPanel(), 500);
  }
});
```

Note: replace the existing `level_up` handler with this one.

- [ ] **Step 4: Add attribute summary to HUD**

Add to HUD HTML:
```html
<div style="margin-top:4px; font-size:12px; color:#aaa">
  STR:<b id="hudStr">0</b> DEX:<b id="hudDex">0</b> VIT:<b id="hudVit">0</b> INT:<b id="hudInt">0</b> LCK:<b id="hudLck">0</b>
</div>
```

Update in ticker:
```javascript
document.getElementById("hudStr").textContent = me.str;
document.getElementById("hudDex").textContent = me.dex;
document.getElementById("hudVit").textContent = me.vit;
document.getElementById("hudInt").textContent = me.intel;
document.getElementById("hudLck").textContent = me.lck;
```

- [ ] **Step 5: Add keybind to open panel manually (P key)**

```javascript
if (keys["p"]) {
  if (!keys._panelSent) {
    keys._panelSent = true;
    if (attrPanel.style.display === "none") showAttrPanel();
    else attrPanel.style.display = "none";
  }
} else {
  keys._panelSent = false;
}
```

- [ ] **Step 6: Verify in browser**

Kill enemies until level up. Verify: panel appears, can distribute points, confirm sends message, stats update.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: client attribute distribution UI panel"
```

---

### Task 9: Client — Skill Tree UI

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add skill tree overlay HTML**

Add after attrPanel div:
```html
<div id="skillTreeOverlay" style="display:none; position:fixed; inset:0; z-index:25; background:rgba(0,0,0,.9);">
  <div style="position:absolute; top:12px; left:50%; transform:translateX(-50%); color:#fff; font:16px system-ui,sans-serif; z-index:26;">
    Arvore de Habilidades — Perks: <b id="perkPointsText">0</b>
    <button id="resetTreeBtn" style="margin-left:12px; padding:4px 12px; border-radius:6px; background:#ff5a5a; color:#fff; border:none; cursor:pointer;">Resetar</button>
    <button id="closeTreeBtn" style="margin-left:8px; padding:4px 12px; border-radius:6px; background:#333; color:#fff; border:none; cursor:pointer;">Fechar (T)</button>
  </div>
  <canvas id="skillTreeCanvas" style="width:100%;height:100%;"></canvas>
</div>
```

- [ ] **Step 2: Add skill tree node data (client-side mirror)**

The client needs the node graph to render it. Embed a minimal version of the node data:

```javascript
// Skill tree node data — mirrors SkillTree.ts
const SKILL_NODES = [
  // Center
  { id:"center", name:"Origin", region:"center", cost:0, conns:["c1","d1","u1"], px:0.5, py:0.5, effects:"Start" },
  // Combat
  { id:"c1", name:"Sharpness I", region:"combat", cost:1, conns:["center","c2","c3"], px:0.38, py:0.42, effects:"+5% melee dmg" },
  { id:"c2", name:"Precision I", region:"combat", cost:1, conns:["c1","c4","c5"], px:0.28, py:0.35, effects:"+5% ranged dmg" },
  { id:"c3", name:"Swift Strikes", region:"combat", cost:1, conns:["c1","c6","mc1"], px:0.42, py:0.32, effects:"+5% atk speed" },
  { id:"c4", name:"Sharpness II", region:"combat", cost:1, conns:["c2","c7"], px:0.2, py:0.28, effects:"+8% melee dmg" },
  { id:"c5", name:"Precision II", region:"combat", cost:1, conns:["c2","c7","c8"], px:0.3, py:0.22, effects:"+8% ranged dmg" },
  { id:"c6", name:"Ferocity", region:"combat", cost:1, conns:["c3","c8","c9"], px:0.45, py:0.2, effects:"+8% atk speed" },
  { id:"c7", name:"Devastation", region:"combat", cost:1, conns:["c4","c5","c10"], px:0.22, py:0.15, effects:"+5% melee+ranged" },
  { id:"c8", name:"Devastating Crit", region:"combat", cost:1, conns:["c5","c6","c10"], px:0.35, py:0.12, effects:"+50% crit dmg" },
  { id:"c9", name:"Double Strike", region:"combat", cost:1, conns:["c6","c11"], px:0.5, py:0.1, effects:"15% double atk" },
  { id:"c10", name:"Sharpness III", region:"combat", cost:1, conns:["c7","c8","c11"], px:0.28, py:0.05, effects:"+10% melee dmg" },
  { id:"c11", name:"Vampirism", region:"combat", cost:1, conns:["c9","c10"], px:0.42, py:0.03, effects:"5% lifesteal" },
  // Defense
  { id:"d1", name:"Toughness I", region:"defense", cost:1, conns:["center","d2","d3"], px:0.38, py:0.58, effects:"+5% max HP" },
  { id:"d2", name:"Regen I", region:"defense", cost:1, conns:["d1","d4","d5"], px:0.28, py:0.65, effects:"+0.5 HP/s" },
  { id:"d3", name:"Thick Skin", region:"defense", cost:1, conns:["d1","d6","mc1"], px:0.42, py:0.68, effects:"3% dmg reduction" },
  { id:"d4", name:"Toughness II", region:"defense", cost:1, conns:["d2","d7"], px:0.2, py:0.72, effects:"+8% max HP" },
  { id:"d5", name:"Regen II", region:"defense", cost:1, conns:["d2","d7","d8"], px:0.3, py:0.78, effects:"+1.0 HP/s" },
  { id:"d6", name:"Iron Will", region:"defense", cost:1, conns:["d3","d8","d9"], px:0.45, py:0.8, effects:"5% dmg reduction" },
  { id:"d7", name:"Toughness III", region:"defense", cost:1, conns:["d4","d5","d10"], px:0.22, py:0.85, effects:"+10% max HP" },
  { id:"d8", name:"Kill Shield", region:"defense", cost:1, conns:["d5","d6","d10"], px:0.35, py:0.88, effects:"+10 HP on kill" },
  { id:"d9", name:"Fortitude", region:"defense", cost:1, conns:["d6","d11","mc2"], px:0.52, py:0.88, effects:"8% dmg reduction" },
  { id:"d10", name:"Regen III", region:"defense", cost:1, conns:["d7","d8","d11"], px:0.28, py:0.95, effects:"+1.5 HP/s" },
  { id:"d11", name:"Second Chance", region:"defense", cost:1, conns:["d9","d10"], px:0.42, py:0.97, effects:"Revive 50% HP/wave" },
  // Utility
  { id:"u1", name:"Swiftness I", region:"utility", cost:1, conns:["center","u2","u3"], px:0.62, py:0.5, effects:"+5% move speed" },
  { id:"u2", name:"Collector I", region:"utility", cost:1, conns:["u1","u4","u5"], px:0.72, py:0.42, effects:"+15% pickup radius" },
  { id:"u3", name:"Fortune I", region:"utility", cost:1, conns:["u1","u6","mc2"], px:0.68, py:0.58, effects:"+3% drop chance" },
  { id:"u4", name:"Swiftness II", region:"utility", cost:1, conns:["u2","u7"], px:0.8, py:0.35, effects:"+8% move speed" },
  { id:"u5", name:"Scholar I", region:"utility", cost:1, conns:["u2","u7","u8"], px:0.78, py:0.48, effects:"+10% XP" },
  { id:"u6", name:"Fortune II", region:"utility", cost:1, conns:["u3","u8","u9"], px:0.75, py:0.65, effects:"+5% drop chance" },
  { id:"u7", name:"Swiftness III", region:"utility", cost:1, conns:["u4","u5","u10"], px:0.88, py:0.4, effects:"+10% move speed" },
  { id:"u8", name:"Lucky Drops", region:"utility", cost:1, conns:["u5","u6","u10"], px:0.85, py:0.55, effects:"+1 rarity shift" },
  { id:"u9", name:"War Aura", region:"utility", cost:1, conns:["u6","u11"], px:0.78, py:0.75, effects:"+10% ally dmg aura" },
  { id:"u10", name:"Scholar II", region:"utility", cost:1, conns:["u7","u8","u11"], px:0.92, py:0.5, effects:"+15% XP" },
  { id:"u11", name:"Collector II", region:"utility", cost:1, conns:["u9","u10"], px:0.9, py:0.68, effects:"+30% pickup radius" },
  // Major
  { id:"mc1", name:"Berserker", region:"major", cost:2, conns:["c3","d3"], px:0.45, py:0.5, effects:"+30% dmg <30% HP" },
  { id:"mc2", name:"Scavenger", region:"major", cost:2, conns:["d9","u3"], px:0.6, py:0.72, effects:"+10% drops +1 rarity" },
];
const SKILL_MAP = new Map(SKILL_NODES.map(n => [n.id, n]));
```

- [ ] **Step 3: Add skill tree canvas rendering function**

```javascript
const REGION_COLORS = { combat: "#ff6b6b", defense: "#4ade80", utility: "#60a5fa", center: "#fbbf24", major: "#c084fc" };

function renderSkillTree(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const me = room.state.players?.get(room.sessionId);
  const activeIds = me ? [...me.activeSkillNodes] : [];

  // Draw connections
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;
  for (const node of SKILL_NODES) {
    const x1 = node.px * w, y1 = node.py * h;
    for (const connId of node.conns) {
      const other = SKILL_MAP.get(connId);
      if (other) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(other.px * w, other.py * h);
        ctx.stroke();
      }
    }
  }

  // Draw nodes
  for (const node of SKILL_NODES) {
    const x = node.px * w, y = node.py * h;
    const isActive = activeIds.includes(node.id);
    const color = REGION_COLORS[node.region] || "#fff";
    const radius = node.cost === 2 ? 18 : 12;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? color : "rgba(40,40,60,0.8)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 3 : 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = "#fff";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(node.name, x, y + radius + 14);
    ctx.font = "9px system-ui";
    ctx.fillStyle = "#aaa";
    ctx.fillText(node.effects, x, y + radius + 26);
  }

  // Perk points
  document.getElementById("perkPointsText").textContent = me ? me.perkPoints : "0";
}
```

- [ ] **Step 4: Add click handler and toggle**

```javascript
const skillTreeOverlay = document.getElementById("skillTreeOverlay");
const skillTreeCanvas = document.getElementById("skillTreeCanvas");

function toggleSkillTree() {
  if (skillTreeOverlay.style.display === "none") {
    skillTreeOverlay.style.display = "block";
    renderSkillTree(skillTreeCanvas);
  } else {
    skillTreeOverlay.style.display = "none";
  }
}

skillTreeCanvas.addEventListener("click", (e) => {
  const rect = skillTreeCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const w = skillTreeCanvas.clientWidth;
  const h = skillTreeCanvas.clientHeight;

  for (const node of SKILL_NODES) {
    const nx = node.px * w, ny = node.py * h;
    if (Math.hypot(mx - nx, my - ny) < 20) {
      room.send("activate_node", { nodeId: node.id });
      setTimeout(() => renderSkillTree(skillTreeCanvas), 100);
      break;
    }
  }
});

document.getElementById("resetTreeBtn").addEventListener("click", () => {
  room.send("reset_tree");
  setTimeout(() => renderSkillTree(skillTreeCanvas), 100);
});

document.getElementById("closeTreeBtn").addEventListener("click", toggleSkillTree);

// T key toggle
// Add to ticker:
if (keys["t"]) {
  if (!keys._treeSent) { keys._treeSent = true; toggleSkillTree(); }
} else { keys._treeSent = false; }

// Perk notification
room.onMessage("perk_available", ({ id }) => {
  if (id === room.sessionId) showToast("NOVO PERK DISPONIVEL! (T)");
});
```

- [ ] **Step 5: Update HUD controls help**

```html
<div><b>T</b> para arvore de habilidades</div>
<div><b>P</b> para atributos</div>
```

- [ ] **Step 6: Verify in browser**

Press T, verify: skill tree overlay shows with all nodes, connections drawn, click nodes to activate, reset works, close with T or button.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: client skill tree UI with interactive web graph"
```

---

## Phase 3: Polish & Verification

### Task 10: Final Integration and Smoke Test

**Files:**
- Possibly minor fixes to any of the above files

- [ ] **Step 1: Full compilation check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Start server and run full play test**

Run: `npx tsx src/server.ts`

Test checklist:
1. Player spawns, wave countdown begins (10s)
2. Wave 1 starts — slimes appear
3. Sword melee attack kills slimes
4. XP gained, level up shows attribute panel
5. Can distribute attribute points
6. Wave 2 — skeletons appear alongside slimes
7. Drops appear on enemy death (5% chance)
8. E key picks up dropped weapon
9. Different weapon types work (if picked up ranged weapon, projectiles fire)
10. Wave 5 — boss spawns (1.5x size, lots of HP)
11. Boss drops guaranteed weapon
12. T key opens skill tree, can activate nodes
13. Skill tree reset works
14. Wave 10+ — creepers appear and explode
15. Multiple players can join and play together

- [ ] **Step 3: Fix any issues found during smoke test**

Address compilation errors, runtime crashes, or visual glitches found during testing.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete RPG upgrade — waves, weapons, enemies, attributes, skill tree"
```
