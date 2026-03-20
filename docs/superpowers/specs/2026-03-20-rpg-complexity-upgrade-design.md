# RPG Complexity Upgrade — Design Spec

## Overview

Expand the existing Colyseus + PixiJS multiplayer RPG from a simple hack-and-slash into a wave-based survival RPG with weapons, enemy variety, bosses, attributes, and a skill tree.

## 1. Wave System

- **Infinite waves** with progressive difficulty scaling.
- **10-second pause** between waves for preparation.
- **Scaling per wave**: enemies gain +8% HP and +5% damage per wave (compounding).
- **Enemies per wave**: `baseCount = 5 + waveNumber * 2` (capped at 80 simultaneous). Enemies spawn in batches of 4-6 every 1.5s until the wave budget is met.
- **Enemy composition by wave**:
  - Wave 1: Slime only
  - Wave 2: +Skeleton
  - Wave 3: +Undead Archer
  - Wave 4: +Wolf
  - Wave 5: Boss wave (no new type)
  - Wave 6: +Golem
  - Wave 8: +Necromancer
  - Wave 10: +Creeper (explosive)
  - Wave 12: +Sorcerer
- **Boss every 5 waves**: giant version of a random enemy type (10x HP, 3x damage, 1.5x size). Always drops a weapon. Boss type is restricted to non-problematic types for balance (see Section 3 for boss behavior overrides).
- **Wave completion**: wave ends when all enemies are killed. Next wave starts after 10s pause.
- **Death during wave**: instant respawn at random position with XP penalty (existing behavior). Wave enemies persist — no reset. Objective is reaching the highest wave.
- **Synced state**: `WaveState` as a nested schema on `GameState` (`@type(WaveState) wave = new WaveState()`) tracks current wave number, state enum (combat/pause), timer countdown, and remaining enemy count.

## 2. Weapons

### 7 Weapon Types — Base Stats

| Weapon      | Category | Cooldown (ms) | Base Damage | Projectile Speed | Range/Radius     | Special               | Scales With |
|-------------|----------|---------------|-------------|------------------|------------------|-----------------------|-------------|
| Sword       | Melee    | 350           | 14          | —                | 90px arc         | —                     | STR         |
| Hammer      | Melee    | 600           | 24          | —                | 90px arc         | Knockback (80px)      | STR         |
| Bow         | Ranged   | 400           | 12          | 500px/s          | 600px max range  | Straight projectile   | DEX         |
| Staff       | Magic    | 700           | 18          | 350px/s          | 60px AoE radius  | Explodes on impact    | INT         |
| Pistol      | Firearm  | 200           | 7           | 700px/s          | 500px max range  | Straight projectile   | DEX         |
| Shotgun     | Firearm  | 650           | 5 x 5 pellets | 550px/s        | 300px max range  | 30-degree cone        | STR         |
| Arcane Orb  | Magic    | 500           | 10          | 300px/s          | 800px max range  | Homing (turn rate 3rad/s) | INT     |

Shotgun fires 5 pellets in a 30-degree cone; each pellet does 5 base damage (25 total if all hit).

### Rarity System (5 tiers)

Rarity multiplier applies to **damage only**. Cooldown, speed, and range are fixed per weapon type.

| Rarity    | Color    | Hex      | Damage Multiplier |
|-----------|----------|----------|-------------------|
| Common    | White    | #ffffff  | 1.0x              |
| Uncommon  | Green    | #4ade80  | 1.2x              |
| Rare      | Blue     | #60a5fa  | 1.5x              |
| Epic      | Purple   | #c084fc  | 2.0x              |
| Legendary | Gold     | #fbbf24  | 3.0x              |

### Attribute Scaling Formula

Final weapon damage = `baseDamage * rarityMultiplier * (1 + scalingAttribute * 0.03)`

Where `scalingAttribute` is STR, DEX, or INT depending on the weapon type.

### Drop Mechanics

- Player starts with a Common Sword.
- No inventory — one weapon equipped at a time.
- Drops require intentional pickup via `pickup_item` message (walk near + press E key, or click).
- If two players send `pickup_item` for the same item, first processed wins; second gets a "item already taken" response.
- Drop appears on ground with rarity-colored glow.
- **Drop TTL**: 30 seconds. Max 40 drops on ground at once (oldest removed first).
- Base drop chance: 5% per normal enemy, 100% per boss.
- Weapon type is random among all 7 types.
- Rarity is random with weighted probabilities:

| Source          | Common | Uncommon | Rare | Epic | Legendary |
|----------------|--------|----------|------|------|-----------|
| Normal enemy   | 60%    | 30%      | 8%   | 2%   | 0%        |
| Enemy wave 10+ | 40%    | 35%      | 18%  | 6%   | 1%        |
| Boss           | 0%     | 20%      | 45%  | 25%  | 10%       |
| Boss wave 25+  | 0%     | 0%       | 30%  | 40%  | 30%       |

- LCK attribute shifts weights upward (+0.5% chance per LCK point to upgrade the rolled tier by one).

### Projectile Rules

- All projectiles (player and enemy) despawn when they exceed their max range or leave world bounds.
- Projectiles are **server-side only** for hit detection (not synced via schema). Visual projectiles are created client-side via `projectile_fired` broadcast.
- No projectile-projectile collision.
- Player projectiles damage enemies only; enemy projectiles damage players only.

## 3. Enemy Types (8)

### Base Stats & Behavior

| Type           | Base HP | Base Damage | Speed (px/s) | XP Reward | Behavior                                              | First Wave |
|----------------|---------|-------------|--------------|-----------|-------------------------------------------------------|-----------|
| Slime          | 20      | 8           | 40           | 8         | Chases nearest player                                 | 1         |
| Skeleton       | 30      | 12          | 55           | 12        | Chases nearest player                                 | 2         |
| Undead Archer  | 18      | 10          | 45           | 14        | Keeps 200px distance, fires projectiles (800ms cooldown). Flees if player within 100px | 3 |
| Wolf           | 15      | 10          | 100          | 10        | Chases nearest player. +20% damage when another wolf is within 80px | 4 |
| Golem          | 100     | 20          | 25           | 25        | Chases nearest player. Takes 50% reduced knockback     | 6         |
| Necromancer    | 25      | 6           | 35           | 20        | Keeps 150px distance. Heals nearby enemies (80px radius) for 5 HP every 2s. Cannot heal self or bosses | 8 |
| Creeper        | 30      | 40          | 70           | 18        | Rushes nearest player. Explodes on contact (100px AoE radius). Dies on detonation. If killed before reaching player, no explosion | 10 |
| Sorcerer       | 20      | 14          | 40           | 22        | Keeps 250px distance. Fires homing projectile (2rad/s turn, 400px range, 1.2s cooldown) | 12 |

All stats scale per wave: HP * `1.08^wave`, Damage * `1.05^wave`.

### Boss Behavior Overrides

Bosses are 10x HP, 3x damage, 1.5x visual size. Additional boss-specific rules:
- **Boss Creeper**: does NOT explode. Instead, slams the ground for AoE damage (100px radius) every 3 seconds while alive. This prevents the one-shot suicide bomb problem.
- **Boss Necromancer**: heal amount scales to 15 HP every 2s, radius increases to 150px.
- **Boss Wolf**: no pack bonus (already strong enough).
- All other boss types: standard 10x HP / 3x damage with their normal AI.

## 4. Attributes & Leveling

### 5 Attributes

| Attribute        | Field Name | Effect                                              |
|------------------|------------|------------------------------------------------------|
| Strength         | str        | +3% melee/shotgun damage per point                   |
| Dexterity        | dex        | +3% ranged damage per point, +0.5% attack speed per point |
| Vitality         | vit        | +10 max HP per point, +0.2 HP regen/s per point     |
| Intelligence     | intel      | +3% magic damage per point                          |
| Luck             | lck        | +0.5% crit chance per point, +0.5% drop tier upgrade per point |

Critical hits deal **2x damage** (modified by skill tree nodes).

### Level Up (max level 100)

- The existing automatic stat growth (maxHp += 20, damage += 4) is **removed**. All stat growth now comes from attribute points and equipment.
- Each level grants **3 attribute points** to distribute freely (300 total at level 100).
- XP requirement scales with 1.45x factor per level (existing behavior).
- UI panel appears on level up to distribute points.

### Perks (every 5 levels)

- At levels 5, 10, 15, ..., 100 the player gains **1 perk point** (20 total).
- Perk points are spent in the Skill Tree.

## 5. Skill Tree (Web/Grid)

### Structure

- ~40-50 interconnected nodes in a web layout (simplified PoE style).
- Player starts at the center node (free, always active).
- Can only activate nodes adjacent to already-active nodes.
- 20 perk points total (levels 5-100).
- **Free reset at any time** — all perk points refunded instantly.
- On reset: all buffs removed immediately. If HP exceeds new maxHP, HP is clamped to new max (minimum 1 HP).
- Buff values from the skill tree are computed on activation/deactivation and cached on the Player schema as derived fields (see Section 7).

### Three Regions

**Combat (Red):**
- +% melee damage, +% ranged damage, +% attack speed
- Devastating Crit (+50% crit damage, making crits deal 2.5x instead of 2x), Double Strike (15% chance to attack twice)
- Vampirism (heal 5% of damage dealt)

**Defense (Green):**
- +% max HP, +HP regen per second
- Kill Shield (gain 10 HP temporary shield for 3s on kill), +% damage reduction
- Second Chance: on death, revive in-place at 50% HP instead of random respawn, and no XP penalty. Once per wave.

**Utility (Blue):**
- +% movement speed, +% pickup radius for drops
- +% drop chance, +1 rarity tier shift on drops
- +% XP bonus, aura that gives +10% damage to allies within 120px

**Major Nodes (intersections — cost 2 points):**
- Located at region boundaries, more powerful effects.
- Example: "Berserker" (Combat/Defense) — +30% damage when below 30% HP.

### Full Node Graph

The full node graph (IDs, positions, connections, effects, costs) will be defined in `src/rooms/SkillTree.ts` during implementation. The spec defines the categories and effect types above; exact layout is an implementation detail that will be tuned during development.

## 6. Multiplayer

- Difficulty is **fixed** regardless of player count.
- All players in the room share the same waves.
- Cooperative — no PvP.
- Max 32 players per room (existing).

## 7. Technical Architecture

### Schema Design (GameState.ts)

```
GameState
├── @type({ map: Player }) players
├── @type({ map: Enemy }) enemies
├── @type({ map: DroppedItem }) droppedItems
├── @type({ map: FloatingText }) floatingTexts
├── @type(WaveState) wave
├── @type("number") worldWidth = 1600
├── @type("number") worldHeight = 1200

Player (expanded)
├── id, name, x, y (existing)
├── hp, maxHp (existing, but no longer auto-incremented on level)
├── level, xp, xpToNext (existing)
├── lastMoveX, lastMoveY (existing)
├── str, dex, vit, intel, lck (number, default 0)
├── unspentPoints (number, default 0)
├── perkPoints (number, default 0)
├── equippedWeaponType (string, default "sword")
├── equippedWeaponRarity (number, default 0 = Common)
├── activeSkillNodes: ArraySchema<string>
├── damage (REMOVED — now computed from weapon + attributes)
├── moveSpeed (number — base 180, modified by DEX and skill tree)
├── critChance (number — computed from LCK + skill tree, synced for UI)
├── hpRegen (number — computed from VIT + skill tree)

Enemy (expanded)
├── id, x, y, hp, maxHp, speed, xpReward (existing)
├── enemyType (string: "slime"|"skeleton"|"archer"|"wolf"|"golem"|"necromancer"|"creeper"|"sorcerer")
├── isBoss (boolean, default false)
├── damage (number — per-enemy, replaces ENEMY_TOUCH_DAMAGE constant)

DroppedItem (new)
├── id (string)
├── x, y (number)
├── weaponType (string)
├── weaponRarity (number: 0-4)
├── ttl (number: 30s countdown)

WaveState (new, nested on GameState)
├── waveNumber (number, default 0)
├── state (string: "waiting"|"combat"|"pause")
├── timer (number: countdown seconds)
├── enemiesRemaining (number)

FloatingText (existing, kept as-is)
```

Note: `Projectile` is NOT in the schema. Projectiles are server-side only for hit detection and broadcast via messages for client-side rendering.

### Server-Side Files

- **`src/rooms/GameState.ts`** — All Colyseus schemas listed above.
- **`src/rooms/GameRoom.ts`** — Main game loop: wave management, spawn composition, enemy AI dispatch, projectile updates (internal array, not schema), drop generation, attribute/perk validation, combat resolution.
- **`src/rooms/EnemyBehaviors.ts`** — AI logic per enemy type (chase, flee, keep-distance, heal, explode, shoot). Takes enemy + game state, returns movement + action.
- **`src/rooms/WeaponSystem.ts`** — Weapon base definitions (the stats table from Section 2), final damage calculation with rarity + attribute scaling, attack execution, projectile creation.
- **`src/rooms/SkillTree.ts`** — Node definitions (id, position, connections, effects, cost), adjacency validation, buff computation, reset logic.

### Client-Side (public/index.html)

- Different visual sprites per enemy type (color/shape variations via Graphics).
- Projectile rendering on `projectile_fired` broadcast (arrows, bullets, magic orbs, shotgun pellets).
- Dropped items on ground with rarity-colored glow.
- Attribute distribution UI panel (on level up).
- Skill tree UI (interactive web/grid rendered with PixiJS overlay).
- Expanded HUD: wave number, wave timer, equipped weapon name + rarity color, attribute summary.
- Attack direction for ranged weapons: fires in last-moved direction (`lastMoveX`/`lastMoveY`). No mouse aiming (keyboard-only controls to match existing WASD design).

### Colyseus Messages (client -> server)

- `move` (existing): `{ x, y }`
- `attack` (existing): no payload. Server reads `equippedWeaponType` and `lastMoveX/Y` to determine attack type and direction.
- `allocate_points`: `{ str, dex, vit, intel, lck }` — distributes unspent attribute points. Server validates sum equals unspent points available.
- `activate_node`: `{ nodeId }` — spends perk point on a skill tree node. Server validates adjacency and point availability.
- `reset_tree`: no payload — refunds all perk points, removes all active nodes.
- `pickup_item`: `{ itemId }` — picks up a dropped weapon. Server validates proximity (within 40px) and item existence.

### Colyseus Broadcasts (server -> clients)

- `swing` (existing): melee visual.
- `projectile_fired`: `{ id, type, x, y, dx, dy, speed, isEnemy }` — client renders projectile locally.
- `projectile_hit`: `{ id }` — client removes projectile visual.
- `level_up` (existing): `{ id, level }`.
- `perk_available`: `{ id, level }` — triggers skill tree notification on client.
- `player_died` (existing): `{ id }`.
- `wave_start`: `{ waveNumber, enemyCount }`.
- `wave_complete`: `{ waveNumber, nextWaveIn }`.
- `boss_spawn`: `{ enemyId, enemyType }`.
- `explosion`: `{ x, y, radius }` — for Creeper detonation visual.
