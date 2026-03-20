# Raylib C Client for Shadowtide

**Date:** 2026-03-20
**Status:** Approved

## Overview

Native desktop client for Shadowtide: Endless Horde written in C with Raylib. Achieves feature parity with the existing PixiJS 2D web client. Connects to the game server via a new raw JSON WebSocket endpoint, bypassing the Colyseus binary protocol.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | C | Native Raylib language, performant |
| Visual style | Geometric (circles, rectangles) | Same as web clients, fast to implement |
| Scope | Full parity with web client | Combat, spells, inventory, skill tree, attributes, HUD |
| WebSocket lib | libwebsockets | Robust, async, well-maintained, cross-platform |
| Build system | Makefile | Simple, no extra dependencies |
| JSON parser | cJSON | Single-file, popular, easy to embed |
| Platform | Linux + Windows | Raylib and lws support both natively |
| Code structure | Flat (few files) | Simple project, no deep nesting |
| Threading | Dedicated network thread + message queues | Classic game client pattern, decouples render from network |
| Server protocol | New /ws/raw endpoint with JSON | Avoids reimplementing Colyseus binary decoder in C |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  main thread                     │
│                                                  │
│   Input → Game State Update → Render → HUD/UI   │
│      ↑                                           │
│      │ dequeue                                   │
│   [msg_queue_in]     [msg_queue_out]             │
│                         │ enqueue                │
│                         ↓                        │
├─────────────────────────────────────────────────┤
│                network thread                    │
│                                                  │
│   libwebsockets event loop                       │
│   recv JSON → enqueue msg_queue_in               │
│   dequeue msg_queue_out → send JSON              │
└─────────────────────────────────────────────────┘
```

### Files

| File | Responsibility |
|------|---------------|
| `main.c` | Entry point, init Raylib + threads, game loop, name entry screen |
| `network.c/h` | Network thread, lws setup, connect/reconnect, message queues |
| `protocol.c/h` | Serialize/deserialize JSON messages (cJSON), message type enums, string-to-enum mappings |
| `game.c/h` | Game state: players, enemies, drops, wave. Process incoming messages |
| `render.c/h` | Draw world: grid, entities, projectiles, spell effects, floating text |
| `ui.c/h` | HUD (HP/mana/XP bars), inventory, spell bar, skill tree, attribute panel |
| `input.c/h` | Process WASD, mouse aim, action keys, generate outgoing messages |

### Embedded Dependencies

- `cJSON.c/h` — JSON parser (copied into project)
- Raylib — linked via system library or submodule
- libwebsockets — linked via system library

## Type Enums and String Mappings

The server uses strings for weapon types, enemy types, spell IDs, and wave states. The C client uses integer enums with string mapping functions in `protocol.c`.

### Weapon Types

```c
typedef enum {
    WEAPON_NONE = -1,
    WEAPON_SWORD = 0,
    WEAPON_HAMMER,
    WEAPON_BOW,
    WEAPON_STAFF,
    WEAPON_PISTOL,
    WEAPON_SHOTGUN,
    WEAPON_ARCANE_ORB,
    WEAPON_COUNT
} WeaponType;

// Maps: "sword"→0, "hammer"→1, "bow"→2, "staff"→3,
//        "pistol"→4, "shotgun"→5, "arcaneOrb"→6
```

### Enemy Types

```c
typedef enum {
    ENEMY_SLIME = 0,
    ENEMY_SKELETON,
    ENEMY_ARCHER,
    ENEMY_WOLF,
    ENEMY_GOLEM,
    ENEMY_NECROMANCER,
    ENEMY_CREEPER,
    ENEMY_SORCERER,
    ENEMY_COUNT
} EnemyType;

// Maps: "slime"→0, "skeleton"→1, "archer"→2, "wolf"→3,
//        "golem"→4, "necromancer"→5, "creeper"→6, "sorcerer"→7
```

### Spell IDs

```c
typedef enum {
    SPELL_NONE = -1,
    SPELL_FIREBALL = 0,
    SPELL_ICE_RAY,
    SPELL_MAGIC_SHIELD,
    SPELL_HEAL,
    SPELL_METEOR,
    SPELL_CHAIN_LIGHTNING,
    SPELL_TELEPORT,
    SPELL_SUMMON_SPIRITS,
    SPELL_ARCANE_STORM,
    SPELL_BLACK_HOLE,
    SPELL_COUNT
} SpellId;

// Maps: "fireball"→0, "iceRay"→1, "magicShield"→2, "heal"→3,
//        "meteor"→4, "chainLightning"→5, "teleport"→6,
//        "summonSpirits"→7, "arcaneStorm"→8, "blackHole"→9
```

### Wave States

```c
typedef enum {
    WAVE_WAITING = 0,
    WAVE_COMBAT,
    WAVE_PAUSE,
} WaveStateEnum;

// Maps: "waiting"→0, "combat"→1, "pause"→2
```

### Rarity (integer, no mapping needed)

```c
// 0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary
// -1 = empty slot
```

`protocol.c` provides `weapon_type_from_string()`, `enemy_type_from_string()`, `spell_id_from_string()`, `wave_state_from_string()` and their reverse `*_to_string()` functions.

## Protocol: Server JSON Endpoint

### Server-Side Changes

**New file:** `src/rooms/RawSocketBridge.ts`

Registered in `src/server.ts`. Creates a WebSocket server on the same HTTP server Colyseus uses, at route `/ws/raw`.

**What the bridge does:**
1. Accepts WebSocket connection, extracts `name` from query params
2. Creates a player in GameRoom via PlayerManager (same path Colyseus uses)
3. Registers listeners on room state using Colyseus onChange/onAdd/onRemove callbacks for efficient diff tracking
4. Every tick (30Hz), collects diffs and sends a `state_patch` JSON message
5. Receives JSON messages from client and calls the same handlers GameRoom.onMessage() uses
6. Forwards all room.broadcast() events to the client as `event` messages
7. On disconnect, removes the player via PlayerManager

**Changes to existing files:**
- `src/server.ts` — import and initialize bridge, pass GameRoom reference
- `src/rooms/GameRoom.ts` — expose broadcast/message handlers for bridge reuse

**What does NOT change:**
- No game logic changes
- Existing Colyseus web clients continue working
- The bridge is an adapter between raw JSON and GameRoom's internal API

### Client Startup Flow

1. Client shows a name entry screen (Raylib text input, simple screen with text field + "Play" button)
2. User types name and presses Enter or clicks Play
3. Client connects to `ws://host:2567/ws/raw?name=PlayerName`
4. Server sends `identity` message with sessionId
5. Server sends `state_sync` with full game state
6. Client enters game loop

### Messages: Server → Client

#### identity

```json
{ "type": "identity", "sessionId": "abc123" }
```

#### state_sync (full state on connect)

```json
{
  "type": "state_sync",
  "players": {
    "sessionId1": {
      "id": "sessionId1",
      "name": "Player1",
      "x": 800, "y": 600,
      "hp": 100, "maxHp": 100,
      "mana": 50, "maxMana": 50, "manaRegen": 2.0,
      "level": 1, "xp": 0, "xpToNext": 40,
      "str": 1, "dex": 1, "vit": 1, "intel": 1, "lck": 1,
      "unspentPoints": 0, "perkPoints": 0,
      "equippedWeaponType": "sword",
      "equippedWeaponRarity": 0,
      "inventory": [
        {"weaponType": "sword", "weaponRarity": 0},
        {"weaponType": "", "weaponRarity": -1},
        {"weaponType": "", "weaponRarity": -1},
        {"weaponType": "", "weaponRarity": -1},
        {"weaponType": "", "weaponRarity": -1}
      ],
      "spellSlots": [
        {"spellId": "", "spellRarity": -1, "cooldownLeft": 0},
        {"spellId": "", "spellRarity": -1, "cooldownLeft": 0},
        {"spellId": "", "spellRarity": -1, "cooldownLeft": 0},
        {"spellId": "", "spellRarity": -1, "cooldownLeft": 0},
        {"spellId": "", "spellRarity": -1, "cooldownLeft": 0}
      ],
      "maxSpellSlots": 2,
      "aimX": 1, "aimY": 0,
      "lastMoveX": 0, "lastMoveY": 0,
      "moveSpeed": 180, "critChance": 0.5, "hpRegen": 1.3,
      "activeSkillNodes": []
    }
  },
  "enemies": {
    "e1": {
      "id": "e1",
      "x": 400, "y": 300,
      "hp": 20, "maxHp": 20,
      "speed": 40, "damage": 8,
      "enemyType": "slime",
      "isBoss": false
    }
  },
  "droppedItems": {
    "d1": {
      "id": "d1",
      "x": 500, "y": 400,
      "weaponType": "bow",
      "weaponRarity": 2,
      "ttl": 25.5
    }
  },
  "droppedSpells": {
    "s1": {
      "id": "s1",
      "x": 600, "y": 350,
      "spellId": "fireball",
      "spellRarity": 1,
      "ttl": 20.0
    }
  },
  "floatingTexts": {
    "ft1": {
      "text": "-15",
      "x": 400, "y": 295,
      "ttl": 0.8
    }
  },
  "wave": {
    "waveNumber": 1,
    "state": "combat",
    "timer": 0,
    "enemiesRemaining": 12
  }
}
```

#### state_patch (incremental diffs, every tick)

Only contains fields that changed. Entity set to `null` means removed.

```json
{
  "type": "state_patch",
  "players": {
    "sessionId1": {"x": 105, "hp": 80, "mana": 45}
  },
  "enemies": {
    "e1": {"x": 410, "y": 305, "hp": 12},
    "e5": null
  },
  "droppedItems": {
    "d1": {"ttl": 24.5},
    "d2": null
  },
  "droppedSpells": {},
  "floatingTexts": {
    "ft1": null,
    "ft2": {"text": "-22", "x": 410, "y": 300, "ttl": 1.0}
  },
  "wave": {
    "enemiesRemaining": 10
  }
}
```

#### event (one-shot broadcasts)

All server broadcasts are forwarded as event messages. Complete list:

```json
// Combat events
{ "type": "event", "event": "swing",
  "data": {"playerId": "id1", "x": 100, "y": 200, "dx": 1, "dy": 0, "weaponType": "sword"} }

{ "type": "event", "event": "projectile_fired",
  "data": {"id": "p1", "type": "bow", "x": 100, "y": 200,
           "dx": 0.7, "dy": 0.7, "speed": 500, "isEnemy": false} }

{ "type": "event", "event": "projectile_hit",
  "data": {"id": "p1"} }

{ "type": "event", "event": "projectile_effect",
  "data": {"id": "p1", "effect": "explosion", "x": 300, "y": 400, "radius": 60} }

{ "type": "event", "event": "explosion",
  "data": {"x": 500, "y": 300, "radius": 100} }

// Spell events
{ "type": "event", "event": "spell_cast",
  "data": {"playerId": "id1", "spellId": "fireball", "x": 100, "y": 200,
           "targetX": 500, "targetY": 300, "rarity": 2} }

{ "type": "event", "event": "spell_effect",
  "data": {"spellId": "meteor", "phase": "impact", "x": 500, "y": 300, "radius": 120} }

{ "type": "event", "event": "spell_end",
  "data": {"spellId": "arcaneStorm", "x": 400, "y": 300} }

{ "type": "event", "event": "spell_spirits_update",
  "data": {"playerId": "id1", "spirits": [{"x": 100, "y": 200}, {"x": 120, "y": 210}]} }

// Game progression events
{ "type": "event", "event": "level_up",
  "data": {"playerId": "id1", "level": 5} }

{ "type": "event", "event": "perk_available",
  "data": {"playerId": "id1"} }

{ "type": "event", "event": "player_died",
  "data": {"playerId": "id1"} }

{ "type": "event", "event": "wave_start",
  "data": {"waveNumber": 3} }

{ "type": "event", "event": "wave_complete",
  "data": {"waveNumber": 3} }

{ "type": "event", "event": "boss_spawn",
  "data": {"enemyType": "golem", "enemyId": "e50"} }
```

### Messages: Client → Server

```json
{ "type": "move", "x": 0.7, "y": -0.7 }
{ "type": "aim", "x": 0.9, "y": -0.4 }
{ "type": "attack" }
{ "type": "cast_spell", "slot": 0, "targetX": 500, "targetY": 300 }
{ "type": "pickup_item", "itemId": "d3" }
{ "type": "pickup_spell", "itemId": "s2" }
{ "type": "swap_weapon", "slot": 1 }
{ "type": "drop_weapon" }
{ "type": "allocate_points", "str": 1, "dex": 0, "vit": 2, "intel": 0, "lck": 0 }
{ "type": "activate_node", "nodeId": "sharpness1" }
{ "type": "reset_tree" }
{ "type": "debug", "action": "giveWeapon", "weaponType": "sword", "rarity": 4 }
{ "type": "debug", "action": "giveSpell", "spellId": "fireball", "rarity": 3 }
{ "type": "debug", "action": "setLevel", "level": 50 }
{ "type": "debug", "action": "heal" }
{ "type": "reset_game" }
```

### Diff Tracking

The bridge uses Colyseus onChange/onAdd/onRemove callbacks on the schema to collect diffs efficiently. Each tick, accumulated diffs are batched into a single `state_patch` message and the diff buffer is cleared.

### Reconnection

If WebSocket disconnects, client waits 2s and retries. On reconnect, receives a fresh `state_sync` — local state is reset.

## Game State (C Structs)

```c
#define MAX_PLAYERS       32
#define MAX_ENEMIES       200
#define MAX_DROPS         80
#define MAX_SPELL_DROPS   40
#define MAX_PROJECTILES   100
#define MAX_FLOAT_TEXTS   50
#define MAX_SPELL_SLOTS   5
#define MAX_INV_SLOTS     5
#define MAX_SKILL_NODES   40
#define ID_LEN            32
#define NAME_LEN          32

typedef struct {
    char id[ID_LEN];
    char name[NAME_LEN];
    float x, y;
    float hp, maxHp;
    float mana, maxMana, manaRegen;
    int level, xp, xpToNext;
    int str, dex, vit, intel, lck;
    int unspentPoints, perkPoints;
    int equippedWeaponType;   // WeaponType enum
    int equippedWeaponRarity; // 0-4, -1=none
    struct { int weaponType; int weaponRarity; } inventory[MAX_INV_SLOTS];
    struct { int spellId; int spellRarity; float cooldownLeft; } spellSlots[MAX_SPELL_SLOTS];
    int maxSpellSlots;
    float aimX, aimY;
    float lastMoveX, lastMoveY;
    float moveSpeed, critChance, hpRegen;
    char activeSkillNodes[MAX_SKILL_NODES][ID_LEN];
    int activeSkillNodeCount;
    bool active;
} Player;

typedef struct {
    char id[ID_LEN];
    float x, y;
    float hp, maxHp;
    float speed, damage;
    int enemyType;  // EnemyType enum
    bool isBoss;
    bool active;
} Enemy;

typedef struct {
    char id[ID_LEN];
    float x, y, dx, dy, speed;
    int type;       // WeaponType or SpellId that fired it
    bool isEnemy;
    bool active;
    float lifetime; // initialized to 3.0s, decremented by dt each frame
} Projectile;

typedef struct {
    char id[ID_LEN];
    float x, y;
    int weaponType, weaponRarity;
    float ttl;
    bool active;
} DroppedItem;

typedef struct {
    char id[ID_LEN];
    float x, y;
    int spellId, spellRarity;
    float ttl;
    bool active;
} DroppedSpell;

typedef struct {
    char text[32];
    float x, y;
    float ttl;      // decremented by dt; text floats up at 18px/s and fades with ttl
    bool active;
} FloatingText;

typedef struct {
    int waveNumber;
    int state;       // WaveStateEnum
    float timer;
    int enemiesRemaining;
} WaveState;

typedef struct {
    Player players[MAX_PLAYERS];
    Enemy enemies[MAX_ENEMIES];
    Projectile projectiles[MAX_PROJECTILES];
    DroppedItem drops[MAX_DROPS];
    DroppedSpell spellDrops[MAX_SPELL_DROPS];
    FloatingText floatTexts[MAX_FLOAT_TEXTS];
    WaveState wave;
    char mySessionId[ID_LEN];
    int worldWidth, worldHeight;
} GameState;
```

Lookups by ID use linear scan (arrays are small enough). Slot with `active == false` is free for reuse.

### Projectile Lifecycle

Projectiles are **client-side only** — not part of state sync. They are created from `projectile_fired` events and removed when:
- A `projectile_hit` event arrives with their ID
- Their `lifetime` (initialized to 3.0s) reaches 0
- They leave world bounds

Each frame: `pos += dir * speed * dt`, `lifetime -= dt`.

## Message Queues

```c
#define MSG_QUEUE_SIZE 256
#define MSG_MAX_LEN    16384

typedef struct {
    char messages[MSG_QUEUE_SIZE][MSG_MAX_LEN];
    int head, tail;
    pthread_mutex_t mutex;
} MessageQueue;
```

Ring buffer with mutex. O(1) enqueue/dequeue. If full, discard oldest message. `MSG_MAX_LEN` is 16KB to accommodate full `state_sync` messages (32 players with full inventory/spells/skill nodes + 200 enemies + drops).

## Rendering

### Camera

```c
offset.x = screenWidth/2 - myPlayer.x;
offset.y = screenHeight/2 - myPlayer.y;
// clamped to world bounds (1600x1200)
```

### Draw Order (back to front)

1. Background (dark gray) + subtle grid
2. Dropped items (diamond shape, colored by rarity)
3. Dropped spells (circle with spell color)
4. Enemies (red circle, HP bar above, larger if boss)
5. Players (green/blue circle, name above, HP bar)
6. Projectiles (small yellow/red circle)
7. Spell effects (semi-transparent circles for AoE, lines for chain lightning)
8. Floating text (rises and fades, white for damage, green for heal)

### Rarity Colors

| Rarity | Color | Hex |
|--------|-------|-----|
| Common | White | #FFFFFF |
| Uncommon | Green | #4ADE80 |
| Rare | Blue | #60A5FA |
| Epic | Purple | #C084FC |
| Legendary | Gold | #FBBF24 |

## UI Layout

### HUD (always visible)

```
┌──────────────────────────────────────────────────┐
│ [HP ████████░░] 80/100    Lv.5    Wave 3 COMBAT │
│ [MP ██████░░░░] 60/100    XP ████░░ 120/200     │
│                                                   │
│                  (game world)                      │
│                                                   │
│ [1:Sword★★] [2:empty] [3:empty] [4:--] [5:--]   │
│ [Z:Fireball] [X:Heal] [C:--] [V:--] [B:--]      │
└──────────────────────────────────────────────────┘
```

### Overlays (toggled)

**P — Attribute Panel:**
- Shows STR/DEX/VIT/INT/LCK with [+] buttons
- Shows derived stats (HP Regen, Move Speed, Crit%)
- Click or press number to allocate points

**T — Skill Tree:**
- Nodes have normalized positions (0.0-1.0) scaled to overlay panel size
- Active node = filled with region color (red/green/blue)
- Available node (adjacent to active) = bright border
- Locked node = dark gray
- Navigate with arrows/mouse, activate with Enter/click
- Skill tree node data (positions, connections, names) is hardcoded in the C client matching the server's SkillTree.ts definitions

### Input Mapping

| Key | Action |
|-----|--------|
| WASD | Movement (normalized direction) |
| Mouse | Aim direction (for ranged) |
| Space | Attack |
| E | Pickup item |
| F | Pickup spell |
| Q | Drop weapon |
| 1-5 | Swap weapon slot |
| Z X C V B | Cast spell slot 0-4 |
| P | Toggle attribute panel |
| T | Toggle skill tree |

## Networking Details

### Send Rate Limits

| Message | Max Rate |
|---------|----------|
| move | 20/s (every 50ms) |
| aim | 15/s (every ~66ms) |
| attack, cast, pickup, etc. | No limit (discrete events) |

### Cross-Platform Threading

- Linux: pthreads
- Windows: pthreads-win32 or native `_beginthreadex` + `CRITICAL_SECTION`
- libwebsockets handles platform differences internally

## Frame Loop

```
1. input_update()          — read keyboard/mouse, enqueue outgoing messages (incl. aim)
2. game_process_messages() — dequeue server messages, update local state
3. game_update(dt)         — interpolate positions, update floating texts, projectile sim, local cooldowns
4. render_world()          — draw grid, entities, projectiles, effects
5. ui_draw()               — HUD, inventory, spell bar, overlays
```
