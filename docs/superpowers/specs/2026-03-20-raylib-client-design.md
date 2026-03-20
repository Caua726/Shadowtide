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
| `main.c` | Entry point, init Raylib + threads, game loop |
| `network.c/h` | Network thread, lws setup, connect/reconnect, message queues |
| `protocol.c/h` | Serialize/deserialize JSON messages (cJSON), message type enums |
| `game.c/h` | Game state: players, enemies, drops, wave. Process incoming messages |
| `render.c/h` | Draw world: grid, entities, projectiles, spell effects, floating text |
| `ui.c/h` | HUD (HP/mana/XP bars), inventory, spell bar, skill tree, attribute panel |
| `input.c/h` | Process WASD, mouse aim, action keys, generate outgoing messages |

### Embedded Dependencies

- `cJSON.c/h` — JSON parser (copied into project)
- Raylib — linked via system library or submodule
- libwebsockets — linked via system library

## Protocol: Server JSON Endpoint

### Server-Side Changes

**New file:** `src/rooms/RawSocketBridge.ts`

Registered in `src/server.ts`. Creates a WebSocket server on the same HTTP server Colyseus uses, at route `/ws/raw`.

**What the bridge does:**
1. Accepts WebSocket connection, extracts `name` from query params
2. Creates a player in GameRoom via PlayerManager (same path Colyseus uses)
3. Registers listeners on room state to detect changes
4. Every tick (30Hz), collects diffs and sends a `state_patch` JSON message
5. Receives JSON messages from client and calls the same handlers GameRoom.onMessage() uses
6. On disconnect, removes the player via PlayerManager

**Changes to existing files:**
- `src/server.ts` — import and initialize bridge, pass GameRoom reference
- `src/rooms/GameRoom.ts` — expose broadcast/message handlers for bridge reuse

**What does NOT change:**
- No game logic changes
- Existing Colyseus web clients continue working
- The bridge is an adapter between raw JSON and GameRoom's internal API

### Messages: Server → Client

```json
// Identity (immediately after connect)
{ "type": "identity", "sessionId": "abc123" }

// Full state sync (on connect)
{ "type": "state_sync", "players": {...}, "enemies": {...},
  "drops": {...}, "spells": {...}, "wave": {...} }

// Incremental diffs (every tick, only changed fields)
{ "type": "state_patch", "players": {"id1": {"x": 100, "hp": 80}},
  "enemies": {"e5": null},
  "drops": {"d3": {"weaponType": "sword", ...}} }

// One-shot events
{ "type": "event", "event": "projectile_fired",
  "data": {"id": "p1", "type": "bow", "x": 100, "y": 200,
           "dx": 0.7, "dy": 0.7, "speed": 500, "isEnemy": false} }

{ "type": "event", "event": "level_up",
  "data": {"playerId": "id1", "level": 5} }
```

### Messages: Client → Server

```json
{ "type": "move", "x": 0.7, "y": -0.7 }
{ "type": "attack" }
{ "type": "cast_spell", "slot": 0, "targetX": 500, "targetY": 300 }
{ "type": "pickup_item", "itemId": "d3" }
{ "type": "pickup_spell", "itemId": "s2" }
{ "type": "swap_weapon", "slot": 1 }
{ "type": "drop_weapon" }
{ "type": "allocate_points", "str": 1, "dex": 0, "vit": 2, "intel": 0, "lck": 0 }
{ "type": "activate_node", "nodeId": "sharpness1" }
{ "type": "reset_tree" }
```

### Diff Tracking

The bridge maintains a snapshot of the last state sent. Each tick, it compares current state to snapshot and only sends changed fields. Removed entities are sent as `null`.

### Reconnection

If WebSocket disconnects, client waits 2s and retries. On reconnect, receives a fresh `state_sync` — local state is reset.

## Game State (C Structs)

```c
#define MAX_PLAYERS      32
#define MAX_ENEMIES      200
#define MAX_DROPS        80
#define MAX_SPELL_DROPS  40
#define MAX_PROJECTILES  100
#define MAX_FLOAT_TEXTS  50
#define MAX_SPELL_SLOTS  5
#define MAX_INV_SLOTS    5
#define ID_LEN           24
#define NAME_LEN         32

typedef struct {
    char id[ID_LEN];
    char name[NAME_LEN];
    float x, y;
    float hp, maxHp;
    float mana, maxMana, manaRegen;
    int level, xp, xpToNext;
    int str, dex, vit, intel, lck;
    int unspentPoints, perkPoints;
    int equippedWeaponType;
    int equippedWeaponRarity;
    struct { int weaponType; int weaponRarity; } inventory[MAX_INV_SLOTS];
    struct { int spellId; int spellRarity; float cooldownLeft; } spellSlots[MAX_SPELL_SLOTS];
    int maxSpellSlots;
    float aimX, aimY;
    float lastMoveX, lastMoveY;
    float moveSpeed, critChance, hpRegen;
    bool active;
} Player;

typedef struct {
    char id[ID_LEN];
    float x, y;
    float hp, maxHp;
    float speed, damage;
    int enemyType;
    bool isBoss;
    bool active;
} Enemy;

typedef struct {
    char id[ID_LEN];
    float x, y, dx, dy, speed;
    int type;
    bool isEnemy;
    bool active;
    float lifetime;
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
    float ttl;
    bool active;
} FloatingText;

typedef struct {
    int waveNumber;
    int state;
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

## Message Queues

```c
#define MSG_QUEUE_SIZE 256
#define MSG_MAX_LEN    4096

typedef struct {
    char messages[MSG_QUEUE_SIZE][MSG_MAX_LEN];
    int head, tail;
    pthread_mutex_t mutex;
} MessageQueue;
```

Ring buffer with mutex. O(1) enqueue/dequeue. If full, discard oldest message.

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
- Grid of nodes connected by lines
- Active node = filled with region color (red/green/blue)
- Available node (adjacent to active) = bright border
- Locked node = dark gray
- Navigate with arrows/mouse, activate with Enter/click

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
1. input_update()          — read keyboard/mouse, enqueue outgoing messages
2. game_process_messages() — dequeue server messages, update local state
3. game_update(dt)         — interpolate positions, update floating texts, local cooldowns
4. render_world()          — draw grid, entities, projectiles, effects
5. ui_draw()               — HUD, inventory, spell bar, overlays
```
