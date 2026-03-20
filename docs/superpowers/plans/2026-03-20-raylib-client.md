# Raylib C Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native C desktop client with Raylib that achieves full feature parity with the existing PixiJS web client, connected via a new raw JSON WebSocket bridge on the server.

**Architecture:** Two-part implementation: (1) a TypeScript WebSocket bridge (`RawSocketBridge.ts`) on the server that exposes game state and events as JSON over raw WebSocket at `/ws/raw`, and (2) a C client using Raylib for rendering, libwebsockets for networking, and cJSON for JSON parsing, with a dedicated network thread communicating via thread-safe message queues.

**Tech Stack:** C (client), TypeScript (bridge), Raylib, libwebsockets, cJSON, ws (npm), pthreads

**Spec:** `docs/superpowers/specs/2026-03-20-raylib-client-design.md`

---

## Part 1: Server-Side Bridge

### Task 1: Create RawSocketBridge skeleton and install ws

**Files:**
- Create: `src/rooms/RawSocketBridge.ts`
- Modify: `package.json`

- [ ] **Step 1: Install ws package**

```bash
npm install ws && npm install -D @types/ws
```

- [ ] **Step 2: Create RawSocketBridge.ts with connection handling**

```typescript
// src/rooms/RawSocketBridge.ts
import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "node:http";
import { GameState, Player, Enemy, DroppedItem, DroppedSpell, FloatingText, InventorySlot, SpellSlot } from "./GameState.js";
import type { SkillBuffs } from "./SkillTree.js";

interface BridgeClient {
  ws: WebSocket;
  sessionId: string;
  name: string;
  lastSnapshot: string; // JSON of last sent state for diff
}

export class RawSocketBridge {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, BridgeClient>();
  private clientSeq = 0;

  constructor(
    private state: GameState,
    private playerBuffs: Map<string, SkillBuffs>,
    private onPlayerJoin: (sessionId: string, name: string) => void,
    private onPlayerLeave: (sessionId: string) => void,
    private onMessage: (sessionId: string, type: string, payload: any) => void,
  ) {}

  attach(server: HTTPServer) {
    this.wss = new WebSocketServer({ server, path: "/ws/raw" });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    console.log("RawSocketBridge listening on /ws/raw");
  }

  private handleConnection(ws: WebSocket, req: any) {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const name = url.searchParams.get("name") || "";
    const sessionId = `raw_${++this.clientSeq}_${Date.now()}`;

    const client: BridgeClient = { ws, sessionId, name, lastSnapshot: "" };
    this.clients.set(ws, client);

    // Create player
    this.onPlayerJoin(sessionId, name);

    // Send identity
    this.send(ws, { type: "identity", sessionId });

    // Send full state sync
    const sync = this.buildStateSync();
    this.send(ws, sync);
    client.lastSnapshot = JSON.stringify(sync);

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type) {
          this.onMessage(sessionId, msg.type, msg);
        }
      } catch {}
    });

    ws.on("close", () => {
      this.onPlayerLeave(sessionId);
      this.clients.delete(ws);
    });

    ws.on("error", () => {
      this.onPlayerLeave(sessionId);
      this.clients.delete(ws);
    });
  }

  private send(ws: WebSocket, msg: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // Called by GameRoom after each tick
  sendPatches() {
    for (const [ws, client] of this.clients) {
      const current = this.buildStateSync();
      const currentStr = JSON.stringify(current);
      if (currentStr !== client.lastSnapshot) {
        const patch = this.buildPatch(JSON.parse(client.lastSnapshot), current);
        if (patch) this.send(ws, patch);
        client.lastSnapshot = currentStr;
      }
    }
  }

  // Called by GameRoom to forward broadcast events
  broadcastEvent(event: string, data: any) {
    const msg = JSON.stringify({ type: "event", event, data });
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  private serializePlayer(p: Player): any {
    return {
      id: p.id, name: p.name, x: p.x, y: p.y,
      hp: p.hp, maxHp: p.maxHp,
      mana: p.mana, maxMana: p.maxMana, manaRegen: p.manaRegen,
      level: p.level, xp: p.xp, xpToNext: p.xpToNext,
      str: p.str, dex: p.dex, vit: p.vit, intel: p.intel, lck: p.lck,
      unspentPoints: p.unspentPoints, perkPoints: p.perkPoints,
      equippedWeaponType: p.equippedWeaponType,
      equippedWeaponRarity: p.equippedWeaponRarity,
      inventory: Array.from({ length: p.inventory.length }, (_, i) => ({
        weaponType: p.inventory[i].weaponType,
        weaponRarity: p.inventory[i].weaponRarity,
      })),
      spellSlots: Array.from({ length: p.spellSlots.length }, (_, i) => ({
        spellId: p.spellSlots[i].spellId,
        spellRarity: p.spellSlots[i].spellRarity,
        cooldownLeft: p.spellSlots[i].cooldownLeft,
      })),
      maxSpellSlots: p.maxSpellSlots,
      aimX: p.aimX, aimY: p.aimY,
      lastMoveX: p.lastMoveX, lastMoveY: p.lastMoveY,
      moveSpeed: p.moveSpeed, critChance: p.critChance, hpRegen: p.hpRegen,
      activeSkillNodes: [...p.activeSkillNodes],
    };
  }

  private buildStateSync(): any {
    const players: any = {};
    this.state.players.forEach((p, id) => { players[id] = this.serializePlayer(p); });

    const enemies: any = {};
    this.state.enemies.forEach((e, id) => {
      enemies[id] = {
        id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp,
        speed: e.speed, damage: e.damage, enemyType: e.enemyType, isBoss: e.isBoss,
      };
    });

    const droppedItems: any = {};
    this.state.droppedItems.forEach((d, id) => {
      droppedItems[id] = { id: d.id, x: d.x, y: d.y, weaponType: d.weaponType, weaponRarity: d.weaponRarity, ttl: d.ttl };
    });

    const droppedSpells: any = {};
    this.state.droppedSpells.forEach((s, id) => {
      droppedSpells[id] = { id: s.id, x: s.x, y: s.y, spellId: s.spellId, spellRarity: s.spellRarity, ttl: s.ttl };
    });

    const floatingTexts: any = {};
    this.state.floatingTexts.forEach((t, id) => {
      floatingTexts[id] = { text: t.text, x: t.x, y: t.y, ttl: t.ttl };
    });

    return {
      type: "state_sync",
      players, enemies, droppedItems, droppedSpells, floatingTexts,
      wave: {
        waveNumber: this.state.wave.waveNumber,
        state: this.state.wave.state,
        timer: this.state.wave.timer,
        enemiesRemaining: this.state.wave.enemiesRemaining,
      },
    };
  }

  private buildPatch(prev: any, curr: any): any | null {
    const patch: any = { type: "state_patch" };
    let hasChanges = false;

    // Diff each entity collection
    for (const key of ["players", "enemies", "droppedItems", "droppedSpells", "floatingTexts"] as const) {
      const prevMap = prev[key] || {};
      const currMap = curr[key] || {};
      const diff: any = {};
      let collectionChanged = false;

      // Changed or new entities
      for (const id of Object.keys(currMap)) {
        if (!prevMap[id] || JSON.stringify(prevMap[id]) !== JSON.stringify(currMap[id])) {
          // Send only changed fields for existing entities
          if (prevMap[id]) {
            const fieldDiff: any = {};
            let fieldChanged = false;
            for (const field of Object.keys(currMap[id])) {
              if (JSON.stringify(prevMap[id][field]) !== JSON.stringify(currMap[id][field])) {
                fieldDiff[field] = currMap[id][field];
                fieldChanged = true;
              }
            }
            if (fieldChanged) { diff[id] = fieldDiff; collectionChanged = true; }
          } else {
            diff[id] = currMap[id]; // New entity: send full
            collectionChanged = true;
          }
        }
      }
      // Removed entities
      for (const id of Object.keys(prevMap)) {
        if (!currMap[id]) { diff[id] = null; collectionChanged = true; }
      }

      if (collectionChanged) { patch[key] = diff; hasChanges = true; }
    }

    // Diff wave
    if (JSON.stringify(prev.wave) !== JSON.stringify(curr.wave)) {
      const waveDiff: any = {};
      for (const field of Object.keys(curr.wave)) {
        if (prev.wave[field] !== curr.wave[field]) {
          waveDiff[field] = curr.wave[field];
        }
      }
      patch.wave = waveDiff;
      hasChanges = true;
    }

    return hasChanges ? patch : null;
  }

  shutdown() {
    for (const [ws, client] of this.clients) {
      this.onPlayerLeave(client.sessionId);
      ws.close();
    }
    this.clients.clear();
    this.wss?.close();
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/rooms/RawSocketBridge.ts package.json package-lock.json
git commit -m "feat: add RawSocketBridge for JSON WebSocket clients"
```

### Task 2: Integrate bridge into server and GameRoom

**Files:**
- Modify: `src/server.ts:1-27`
- Modify: `src/rooms/GameRoom.ts:1-254`

- [ ] **Step 1: Modify GameRoom to accept and use the bridge**

Add bridge reference and hook it into broadcasts and tick:

In `src/rooms/GameRoom.ts`, add after the imports (line 9):

```typescript
import { RawSocketBridge } from "./RawSocketBridge.js";
```

Add to class properties (after line 27):

```typescript
bridge?: RawSocketBridge;
```

Add public method to set bridge (after `onCreate`, before `registerMessages`):

```typescript
setBridge(bridge: RawSocketBridge) {
  this.bridge = bridge;
}
```

Modify the broadcast wrapper: replace all `(type, data) => this.broadcast(type, data)` patterns to also forward to bridge. Create a helper method:

```typescript
private broadcastAll(type: string, data: any) {
  this.broadcast(type, data);
  this.bridge?.broadcastEvent(type, data);
}
```

Replace the 3 broadcast callback lambdas (lines 34, 47, 54) and the inline broadcast calls (lines 152, 170) with `this.broadcastAll`.

In the `update()` method (after line 240), add:

```typescript
this.bridge?.sendPatches();
```

Add public methods for bridge to call into message handlers:

```typescript
handleBridgeMessage(sessionId: string, type: string, payload: any) {
  // Reuse the same logic as onMessage handlers
  switch (type) {
    case "move": {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 0;
      const len = Math.hypot(x, y);
      if (len > 0) {
        this.playerManager.inputByClient.set(sessionId, { x: x / len, y: y / len });
      } else {
        this.playerManager.inputByClient.set(sessionId, { x: 0, y: 0 });
      }
      break;
    }
    case "aim": {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 1;
      const len = Math.hypot(x, y) || 1;
      this.playerManager.aimByClient.set(sessionId, { x: x / len, y: y / len });
      const player = this.state.players.get(sessionId);
      if (player) { player.aimX = x / len; player.aimY = y / len; }
      break;
    }
    case "attack":
      this.combatSystem.handleAttack(sessionId);
      break;
    case "allocate_points":
      this.playerManager.handleAllocatePoints(sessionId, payload);
      break;
    case "activate_node":
      this.playerManager.handleActivateNode(sessionId, payload);
      break;
    case "reset_tree":
      this.playerManager.handleResetTree(sessionId);
      break;
    case "pickup_item":
      this.dropSystem.handlePickupItem(sessionId, payload);
      break;
    case "pickup_spell":
      this.dropSystem.handlePickupSpell(sessionId, payload);
      break;
    case "cast_spell":
      this.spellCaster.handleCastSpell(sessionId, Number(payload?.slot) || 0, Number(payload?.targetX) || 0, Number(payload?.targetY) || 0);
      break;
    case "swap_weapon": {
      const player = this.state.players.get(sessionId);
      if (!player) return;
      const slot = Number(payload?.slot);
      if (slot < 0 || slot >= 5 || !Number.isInteger(slot)) return;
      const invSlot = player.inventory[slot];
      if (!invSlot || invSlot.weaponRarity < 0) return;
      const oldType = player.equippedWeaponType;
      const oldRarity = player.equippedWeaponRarity;
      player.equippedWeaponType = invSlot.weaponType;
      player.equippedWeaponRarity = invSlot.weaponRarity;
      invSlot.weaponType = oldType;
      invSlot.weaponRarity = oldRarity;
      break;
    }
    case "drop_weapon": {
      const player = this.state.players.get(sessionId);
      if (!player) return;
      if (player.equippedWeaponType === "sword" && player.equippedWeaponRarity === 0) return;
      const item = new DroppedItem();
      item.id = `d${this.dropSystem.dropSeq++}`;
      item.x = player.x;
      item.y = player.y;
      item.weaponType = player.equippedWeaponType;
      item.weaponRarity = player.equippedWeaponRarity;
      item.ttl = 30;
      this.state.droppedItems.set(item.id, item);
      player.equippedWeaponType = "sword";
      player.equippedWeaponRarity = 0;
      break;
    }
    case "reset_game": {
      this.state.wave.waveNumber = 0;
      this.state.wave.state = "waiting";
      this.state.wave.timer = 0;
      this.state.wave.enemiesRemaining = 0;
      this.state.enemies.clear();
      this.state.droppedItems.clear();
      this.state.droppedSpells.clear();
      this.state.floatingTexts.clear();
      if (this.state.players.size > 0) this.waveManager.startWavePause();
      this.broadcastAll("wave_complete", { waveNumber: 0, nextWaveIn: 10 });
      break;
    }
    case "debug": {
      const player = this.state.players.get(sessionId);
      if (!player) return;
      const cmd = payload?.cmd;
      switch (cmd) {
        case "level_up": {
          const levels = Math.min(Number(payload?.amount) || 1, 100 - player.level);
          for (let i = 0; i < levels; i++) {
            player.level++;
            player.unspentPoints += 3;
            if (player.level % 5 === 0) player.perkPoints++;
            player.xpToNext = Math.round(player.xpToNext * 1.45);
          }
          player.hp = player.maxHp;
          this.broadcastAll("level_up", { id: sessionId, level: player.level });
          break;
        }
        case "give_weapon": {
          player.equippedWeaponType = payload?.weaponType || "sword";
          player.equippedWeaponRarity = Math.min(Math.max(Number(payload?.rarity) || 0, 0), 4);
          break;
        }
        case "give_spell": {
          const sId = payload?.spellId || "fireball";
          const sRarity = Math.min(Math.max(Number(payload?.rarity) || 0, 0), 4);
          const slotIdx = Number(payload?.slot) || 0;
          if (slotIdx >= 0 && slotIdx < 5 && player.spellSlots[slotIdx]) {
            player.spellSlots[slotIdx].spellId = sId;
            player.spellSlots[slotIdx].spellRarity = sRarity;
            player.spellSlots[slotIdx].cooldownLeft = 0;
          }
          break;
        }
        case "set_stats": {
          player.str = Number(payload?.str) ?? player.str;
          player.dex = Number(payload?.dex) ?? player.dex;
          player.vit = Number(payload?.vit) ?? player.vit;
          player.intel = Number(payload?.intel) ?? player.intel;
          player.lck = Number(payload?.lck) ?? player.lck;
          this.playerManager.recomputeDerivedStats(player);
          break;
        }
        case "heal": {
          player.hp = player.maxHp;
          player.mana = player.maxMana;
          break;
        }
        case "max_spell_slots": {
          player.maxSpellSlots = 5;
          break;
        }
      }
      break;
    }
  }
}
```

- [ ] **Step 2: Modify server.ts to create and attach bridge**

Replace `src/server.ts` content:

```typescript
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineRoom, defineServer } from "colyseus";
import { GameRoom } from "./rooms/GameRoom.js";
import { RawSocketBridge } from "./rooms/RawSocketBridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT || 2567);

let gameRoomInstance: GameRoom | null = null;

const server = defineServer({
  rooms: {
    world: defineRoom(GameRoom),
  },
  express: (app) => {
    app.use(express.static(path.join(__dirname, "../public")));
    app.get("/health", (_req, res) => {
      res.json({ ok: true, room: "world" });
    });
  },
});

server.listen(port).then((transport) => {
  console.log(`HTTP + client em http://localhost:${port}`);
  console.log("Colyseus room: world");

  // Attach bridge to the underlying HTTP server
  const httpServer = (transport as any).server;
  if (httpServer) {
    // Bridge will be set on GameRoom when the first room is created
    // We need to hook into room creation
    const origDefine = server.define;
    console.log("RawSocketBridge: will attach when GameRoom is created");

    // Watch for GameRoom instance via a polling approach
    // The bridge attaches when the first client joins and the room is created
    const checkRoom = setInterval(() => {
      // Access internal matchmaker to find room
      try {
        const rooms = (server as any).matchMaker?.localRooms;
        if (rooms) {
          for (const room of rooms.values()) {
            if (room instanceof GameRoom && !room.bridge) {
              const bridge = new RawSocketBridge(
                room.state,
                (room as any).playerBuffs,
                (sessionId, name) => {
                  room.playerManager.createPlayer(sessionId, name, room.state.players.size + 1);
                },
                (sessionId) => {
                  room.playerManager.removePlayer(sessionId);
                  room.combatSystem.cleanupClient(sessionId);
                },
                (sessionId, type, payload) => {
                  room.handleBridgeMessage(sessionId, type, payload);
                },
              );
              bridge.attach(httpServer);
              room.setBridge(bridge);
              clearInterval(checkRoom);
              console.log("RawSocketBridge attached to GameRoom");
            }
          }
        }
      } catch {}
    }, 1000);
  }
});
```

- [ ] **Step 3: Make GameRoom subsystems accessible to bridge**

In `src/rooms/GameRoom.ts`, change `private` to `public` for the subsystems the bridge needs:

```typescript
// Change from private to public:
public playerManager!: PlayerManager;
public combatSystem!: CombatSystem;
public spellCaster!: SpellCaster;
public dropSystem!: DropSystem;
```

Keep `waveManager`, `saveInterval`, `secondChanceUsed`, `playerBuffs` as they are (bridge doesn't need direct access to waveManager, it accesses playerBuffs via constructor).

- [ ] **Step 4: Test bridge manually**

```bash
npm run dev &
# Wait for server to start, then test with wscat:
npx wscat -c "ws://localhost:2567/ws/raw?name=TestPlayer"
# Should receive:
# {"type":"identity","sessionId":"raw_1_..."}
# {"type":"state_sync","players":{...},...}
```

- [ ] **Step 5: Commit**

```bash
git add src/rooms/GameRoom.ts src/server.ts src/rooms/RawSocketBridge.ts package.json package-lock.json
git commit -m "feat: integrate RawSocketBridge into server with event forwarding"
```

---

## Part 2: Client Foundation

### Task 3: Project setup — directories, Makefile, dependencies

**Files:**
- Create: `client/Makefile`
- Create: `client/src/` (directory)
- Create: `client/deps/cJSON/cJSON.c` (downloaded)
- Create: `client/deps/cJSON/cJSON.h` (downloaded)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p client/src client/deps/cJSON
```

- [ ] **Step 2: Download cJSON**

```bash
curl -sL https://raw.githubusercontent.com/DaveGamble/cJSON/master/cJSON.c -o client/deps/cJSON/cJSON.c
curl -sL https://raw.githubusercontent.com/DaveGamble/cJSON/master/cJSON.h -o client/deps/cJSON/cJSON.h
```

- [ ] **Step 3: Create Makefile**

```makefile
# client/Makefile
CC = gcc
CFLAGS = -Wall -Wextra -std=c11 -O2 -Ideps/cJSON
LDFLAGS = -lraylib -lwebsockets -lm -lpthread

# Platform detection
UNAME := $(shell uname -s)
ifeq ($(UNAME),Linux)
    LDFLAGS += -lGL -ldl
endif

SRC = src/main.c src/network.c src/protocol.c src/game.c src/render.c src/ui.c src/input.c deps/cJSON/cJSON.c
OBJ = $(SRC:.c=.o)
BIN = shadowtide

all: $(BIN)

$(BIN): $(OBJ)
	$(CC) $(OBJ) -o $@ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJ) $(BIN)

.PHONY: all clean
```

- [ ] **Step 4: Verify build dependencies are installed**

```bash
# Check raylib
pkg-config --cflags --libs raylib 2>/dev/null || echo "NEED: Install raylib (sudo pacman -S raylib)"

# Check libwebsockets
pkg-config --cflags --libs libwebsockets 2>/dev/null || echo "NEED: Install libwebsockets (sudo pacman -S libwebsockets)"
```

- [ ] **Step 5: Commit**

```bash
git add client/
git commit -m "feat: scaffold Raylib C client project with Makefile and cJSON"
```

### Task 4: protocol.c/h — enums, string mappings, message types

**Files:**
- Create: `client/src/protocol.h`
- Create: `client/src/protocol.c`

- [ ] **Step 1: Create protocol.h**

```c
// client/src/protocol.h
#ifndef PROTOCOL_H
#define PROTOCOL_H

#include "cJSON.h"

// === Weapon Types ===
typedef enum {
    WEAPON_NONE = -1,
    WEAPON_SWORD = 0, WEAPON_HAMMER, WEAPON_BOW, WEAPON_STAFF,
    WEAPON_PISTOL, WEAPON_SHOTGUN, WEAPON_ARCANE_ORB,
    WEAPON_COUNT
} WeaponType;

int weapon_type_from_string(const char *s);
const char *weapon_type_to_string(int type);

// === Enemy Types ===
typedef enum {
    ENEMY_SLIME = 0, ENEMY_SKELETON, ENEMY_ARCHER, ENEMY_WOLF,
    ENEMY_GOLEM, ENEMY_NECROMANCER, ENEMY_CREEPER, ENEMY_SORCERER,
    ENEMY_COUNT
} EnemyType;

int enemy_type_from_string(const char *s);

// === Spell IDs ===
typedef enum {
    SPELL_NONE = -1,
    SPELL_FIREBALL = 0, SPELL_ICE_RAY, SPELL_MAGIC_SHIELD, SPELL_HEAL,
    SPELL_METEOR, SPELL_CHAIN_LIGHTNING, SPELL_TELEPORT,
    SPELL_SUMMON_SPIRITS, SPELL_ARCANE_STORM, SPELL_BLACK_HOLE,
    SPELL_COUNT
} SpellId;

int spell_id_from_string(const char *s);
const char *spell_id_to_string(int id);

// === Wave States ===
typedef enum {
    WAVE_WAITING = 0, WAVE_COMBAT, WAVE_PAUSE
} WaveStateEnum;

int wave_state_from_string(const char *s);

// === Server Message Types ===
typedef enum {
    MSG_IDENTITY, MSG_STATE_SYNC, MSG_STATE_PATCH, MSG_EVENT, MSG_UNKNOWN
} ServerMsgType;

ServerMsgType server_msg_type(const char *type_str);

// === Message builders (client → server) ===
// All return malloc'd strings. Caller must free.
char *msg_move(float x, float y);
char *msg_aim(float x, float y);
char *msg_attack(void);
char *msg_cast_spell(int slot, float targetX, float targetY);
char *msg_pickup_item(const char *itemId);
char *msg_pickup_spell(const char *itemId);
char *msg_swap_weapon(int slot);
char *msg_drop_weapon(void);
char *msg_allocate_points(int str, int dex, int vit, int intel, int lck);
char *msg_activate_node(const char *nodeId);
char *msg_reset_tree(void);
char *msg_debug(const char *cmd, cJSON *extra);
char *msg_reset_game(void);

#endif
```

- [ ] **Step 2: Create protocol.c**

```c
// client/src/protocol.c
#include "protocol.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// === String mapping tables ===

static const char *WEAPON_STRINGS[] = {
    "sword", "hammer", "bow", "staff", "pistol", "shotgun", "arcaneOrb"
};

int weapon_type_from_string(const char *s) {
    if (!s) return WEAPON_NONE;
    for (int i = 0; i < WEAPON_COUNT; i++)
        if (strcmp(s, WEAPON_STRINGS[i]) == 0) return i;
    return WEAPON_NONE;
}

const char *weapon_type_to_string(int type) {
    if (type < 0 || type >= WEAPON_COUNT) return "";
    return WEAPON_STRINGS[type];
}

static const char *ENEMY_STRINGS[] = {
    "slime", "skeleton", "archer", "wolf", "golem", "necromancer", "creeper", "sorcerer"
};

int enemy_type_from_string(const char *s) {
    if (!s) return 0;
    for (int i = 0; i < ENEMY_COUNT; i++)
        if (strcmp(s, ENEMY_STRINGS[i]) == 0) return i;
    return 0;
}

static const char *SPELL_STRINGS[] = {
    "fireball", "iceRay", "magicShield", "heal", "meteor",
    "chainLightning", "teleport", "summonSpirits", "arcaneStorm", "blackHole"
};

int spell_id_from_string(const char *s) {
    if (!s || !s[0]) return SPELL_NONE;
    for (int i = 0; i < SPELL_COUNT; i++)
        if (strcmp(s, SPELL_STRINGS[i]) == 0) return i;
    return SPELL_NONE;
}

const char *spell_id_to_string(int id) {
    if (id < 0 || id >= SPELL_COUNT) return "";
    return SPELL_STRINGS[id];
}

int wave_state_from_string(const char *s) {
    if (!s) return WAVE_WAITING;
    if (strcmp(s, "combat") == 0) return WAVE_COMBAT;
    if (strcmp(s, "pause") == 0) return WAVE_PAUSE;
    return WAVE_WAITING;
}

ServerMsgType server_msg_type(const char *type_str) {
    if (!type_str) return MSG_UNKNOWN;
    if (strcmp(type_str, "identity") == 0) return MSG_IDENTITY;
    if (strcmp(type_str, "state_sync") == 0) return MSG_STATE_SYNC;
    if (strcmp(type_str, "state_patch") == 0) return MSG_STATE_PATCH;
    if (strcmp(type_str, "event") == 0) return MSG_EVENT;
    return MSG_UNKNOWN;
}

// === Message builders ===

static char *json_to_string(cJSON *obj) {
    char *str = cJSON_PrintUnformatted(obj);
    cJSON_Delete(obj);
    return str;
}

char *msg_move(float x, float y) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "move");
    cJSON_AddNumberToObject(m, "x", x);
    cJSON_AddNumberToObject(m, "y", y);
    return json_to_string(m);
}

char *msg_aim(float x, float y) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "aim");
    cJSON_AddNumberToObject(m, "x", x);
    cJSON_AddNumberToObject(m, "y", y);
    return json_to_string(m);
}

char *msg_attack(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "attack");
    return json_to_string(m);
}

char *msg_cast_spell(int slot, float targetX, float targetY) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "cast_spell");
    cJSON_AddNumberToObject(m, "slot", slot);
    cJSON_AddNumberToObject(m, "targetX", targetX);
    cJSON_AddNumberToObject(m, "targetY", targetY);
    return json_to_string(m);
}

char *msg_pickup_item(const char *itemId) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "pickup_item");
    cJSON_AddStringToObject(m, "itemId", itemId);
    return json_to_string(m);
}

char *msg_pickup_spell(const char *itemId) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "pickup_spell");
    cJSON_AddStringToObject(m, "itemId", itemId);
    return json_to_string(m);
}

char *msg_swap_weapon(int slot) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "swap_weapon");
    cJSON_AddNumberToObject(m, "slot", slot);
    return json_to_string(m);
}

char *msg_drop_weapon(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "drop_weapon");
    return json_to_string(m);
}

char *msg_allocate_points(int str, int dex, int vit, int intel, int lck) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "allocate_points");
    cJSON_AddNumberToObject(m, "str", str);
    cJSON_AddNumberToObject(m, "dex", dex);
    cJSON_AddNumberToObject(m, "vit", vit);
    cJSON_AddNumberToObject(m, "intel", intel);
    cJSON_AddNumberToObject(m, "lck", lck);
    return json_to_string(m);
}

char *msg_activate_node(const char *nodeId) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "activate_node");
    cJSON_AddStringToObject(m, "nodeId", nodeId);
    return json_to_string(m);
}

char *msg_reset_tree(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "reset_tree");
    return json_to_string(m);
}

char *msg_debug(const char *cmd, cJSON *extra) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "debug");
    cJSON_AddStringToObject(m, "cmd", cmd);
    if (extra) {
        cJSON *child = extra->child;
        while (child) {
            cJSON *next = child->next;
            cJSON_DetachItemViaPointer(extra, child);
            cJSON_AddItemToObject(m, child->string, child);
            child = next;
        }
        cJSON_Delete(extra);
    }
    return json_to_string(m);
}

char *msg_reset_game(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "reset_game");
    return json_to_string(m);
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/protocol.c client/src/protocol.h
git commit -m "feat: add protocol layer with enums, string mappings, message builders"
```

### Task 5: network.c/h — thread-safe message queues and WebSocket client

**Files:**
- Create: `client/src/network.h`
- Create: `client/src/network.c`

- [ ] **Step 1: Create network.h**

```c
// client/src/network.h
#ifndef NETWORK_H
#define NETWORK_H

#include <stdbool.h>
#include <pthread.h>

#define MSG_QUEUE_SIZE 256
#define MSG_MAX_LEN    16384

typedef struct {
    char messages[MSG_QUEUE_SIZE][MSG_MAX_LEN];
    int head;
    int tail;
    pthread_mutex_t mutex;
} MessageQueue;

void mq_init(MessageQueue *q);
bool mq_enqueue(MessageQueue *q, const char *msg);
bool mq_dequeue(MessageQueue *q, char *out, int out_len);
bool mq_empty(MessageQueue *q);

// Network state
typedef enum {
    NET_DISCONNECTED,
    NET_CONNECTING,
    NET_CONNECTED,
} NetState;

typedef struct {
    MessageQueue inbox;   // server → client
    MessageQueue outbox;  // client → server
    NetState state;
    bool running;
    pthread_t thread;
    char host[256];
    int port;
    char player_name[32];
} NetworkContext;

void net_init(NetworkContext *ctx, const char *host, int port, const char *name);
void net_start(NetworkContext *ctx);
void net_stop(NetworkContext *ctx);
void net_send(NetworkContext *ctx, const char *json_msg);

#endif
```

- [ ] **Step 2: Create network.c**

```c
// client/src/network.c
#include "network.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <libwebsockets.h>

// === Message Queue ===

void mq_init(MessageQueue *q) {
    q->head = 0;
    q->tail = 0;
    pthread_mutex_init(&q->mutex, NULL);
}

bool mq_enqueue(MessageQueue *q, const char *msg) {
    pthread_mutex_lock(&q->mutex);
    int next = (q->tail + 1) % MSG_QUEUE_SIZE;
    if (next == q->head) {
        // Full — discard oldest
        q->head = (q->head + 1) % MSG_QUEUE_SIZE;
    }
    strncpy(q->messages[q->tail], msg, MSG_MAX_LEN - 1);
    q->messages[q->tail][MSG_MAX_LEN - 1] = '\0';
    q->tail = next;
    pthread_mutex_unlock(&q->mutex);
    return true;
}

bool mq_dequeue(MessageQueue *q, char *out, int out_len) {
    pthread_mutex_lock(&q->mutex);
    if (q->head == q->tail) {
        pthread_mutex_unlock(&q->mutex);
        return false;
    }
    strncpy(out, q->messages[q->head], out_len - 1);
    out[out_len - 1] = '\0';
    q->head = (q->head + 1) % MSG_QUEUE_SIZE;
    pthread_mutex_unlock(&q->mutex);
    return true;
}

bool mq_empty(MessageQueue *q) {
    pthread_mutex_lock(&q->mutex);
    bool empty = (q->head == q->tail);
    pthread_mutex_unlock(&q->mutex);
    return empty;
}

// === WebSocket Client ===

static NetworkContext *g_ctx = NULL;
static struct lws *g_wsi = NULL;
static unsigned char g_recv_buf[MSG_MAX_LEN];
static int g_recv_len = 0;

static int ws_callback(struct lws *wsi, enum lws_callback_reasons reason,
                       void *user, void *in, size_t len) {
    (void)user;

    switch (reason) {
    case LWS_CALLBACK_CLIENT_ESTABLISHED:
        g_ctx->state = NET_CONNECTED;
        lws_callback_on_writable(wsi);
        break;

    case LWS_CALLBACK_CLIENT_RECEIVE: {
        // Accumulate fragments
        if (g_recv_len + (int)len < MSG_MAX_LEN - 1) {
            memcpy(g_recv_buf + g_recv_len, in, len);
            g_recv_len += (int)len;
        }
        if (lws_is_final_fragment(wsi)) {
            g_recv_buf[g_recv_len] = '\0';
            mq_enqueue(&g_ctx->inbox, (char *)g_recv_buf);
            g_recv_len = 0;
        }
        break;
    }

    case LWS_CALLBACK_CLIENT_WRITEABLE: {
        char msg[MSG_MAX_LEN];
        if (mq_dequeue(&g_ctx->outbox, msg, MSG_MAX_LEN)) {
            int msglen = (int)strlen(msg);
            unsigned char buf[LWS_PRE + MSG_MAX_LEN];
            memcpy(&buf[LWS_PRE], msg, msglen);
            lws_write(wsi, &buf[LWS_PRE], msglen, LWS_WRITE_TEXT);
        }
        // Always request writable callback to drain outbox
        if (!mq_empty(&g_ctx->outbox)) {
            lws_callback_on_writable(wsi);
        }
        break;
    }

    case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
    case LWS_CALLBACK_CLIENT_CLOSED:
        g_ctx->state = NET_DISCONNECTED;
        g_wsi = NULL;
        g_recv_len = 0;
        break;

    default:
        break;
    }

    return 0;
}

static const struct lws_protocols protocols[] = {
    { "shadowtide", ws_callback, 0, MSG_MAX_LEN },
    { NULL, NULL, 0, 0 }
};

static void *network_thread(void *arg) {
    NetworkContext *ctx = (NetworkContext *)arg;
    g_ctx = ctx;

    while (ctx->running) {
        struct lws_context_creation_info info;
        memset(&info, 0, sizeof(info));
        info.port = CONTEXT_PORT_NO_LISTEN;
        info.protocols = protocols;
        info.options = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;

        struct lws_context *context = lws_create_context(&info);
        if (!context) {
            sleep(2);
            continue;
        }

        // Build path with name query param
        char path[512];
        snprintf(path, sizeof(path), "/ws/raw?name=%s", ctx->player_name);

        struct lws_client_connect_info ccinfo;
        memset(&ccinfo, 0, sizeof(ccinfo));
        ccinfo.context = context;
        ccinfo.address = ctx->host;
        ccinfo.port = ctx->port;
        ccinfo.path = path;
        ccinfo.host = ctx->host;
        ccinfo.origin = ctx->host;
        ccinfo.protocol = "shadowtide";

        ctx->state = NET_CONNECTING;
        g_wsi = lws_client_connect_via_info(&ccinfo);

        if (!g_wsi) {
            lws_context_destroy(context);
            sleep(2);
            continue;
        }

        // Event loop
        while (ctx->running && ctx->state != NET_DISCONNECTED) {
            lws_service(context, 50);

            // Request writable if we have outgoing messages
            if (g_wsi && !mq_empty(&ctx->outbox)) {
                lws_callback_on_writable(g_wsi);
            }
        }

        lws_context_destroy(context);

        if (ctx->running) {
            // Reconnect delay
            sleep(2);
        }
    }

    return NULL;
}

// === Public API ===

void net_init(NetworkContext *ctx, const char *host, int port, const char *name) {
    memset(ctx, 0, sizeof(*ctx));
    mq_init(&ctx->inbox);
    mq_init(&ctx->outbox);
    ctx->state = NET_DISCONNECTED;
    ctx->running = false;
    strncpy(ctx->host, host, sizeof(ctx->host) - 1);
    ctx->port = port;
    strncpy(ctx->player_name, name, sizeof(ctx->player_name) - 1);
}

void net_start(NetworkContext *ctx) {
    ctx->running = true;
    pthread_create(&ctx->thread, NULL, network_thread, ctx);
}

void net_stop(NetworkContext *ctx) {
    ctx->running = false;
    pthread_join(ctx->thread, NULL);
}

void net_send(NetworkContext *ctx, const char *json_msg) {
    mq_enqueue(&ctx->outbox, json_msg);
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/network.c client/src/network.h
git commit -m "feat: add network layer with thread-safe queues and lws WebSocket client"
```

### Task 6: game.c/h — game state, state_sync, state_patch, events

**Files:**
- Create: `client/src/game.h`
- Create: `client/src/game.c`

- [ ] **Step 1: Create game.h**

```c
// client/src/game.h
#ifndef GAME_H
#define GAME_H

#include <stdbool.h>
#include "protocol.h"

#define MAX_PLAYERS       32
#define MAX_ENEMIES       200
#define MAX_DROPS         80
#define MAX_SPELL_DROPS   40
#define MAX_PROJECTILES   100
#define MAX_FLOAT_TEXTS   50
#define MAX_SPELL_SLOTS   5
#define MAX_INV_SLOTS     5
#define MAX_SKILL_NODES   40
#define MAX_SPELL_EFFECTS 20
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
    int equippedWeaponType;
    int equippedWeaponRarity;
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
} WaveInfo;

// Visual-only spell effects (client-side)
typedef struct {
    char id[ID_LEN];
    int spellId;
    float x, y;
    float radius;
    float ttl;
    bool active;
} SpellEffect;

// Swing visual (melee attack arc)
typedef struct {
    float x, y, dx, dy;
    float ttl;
    int weaponType;
    bool active;
} SwingEffect;

#define MAX_SWINGS 16

typedef struct {
    Player players[MAX_PLAYERS];
    Enemy enemies[MAX_ENEMIES];
    Projectile projectiles[MAX_PROJECTILES];
    DroppedItem drops[MAX_DROPS];
    DroppedSpell spellDrops[MAX_SPELL_DROPS];
    FloatingText floatTexts[MAX_FLOAT_TEXTS];
    SpellEffect spellEffects[MAX_SPELL_EFFECTS];
    SwingEffect swings[MAX_SWINGS];
    WaveInfo wave;
    char mySessionId[ID_LEN];
    int worldWidth, worldHeight;
    bool connected;
} GameState;

void game_init(GameState *gs);
void game_process_message(GameState *gs, const char *json_str);
void game_update(GameState *gs, float dt);

Player *game_find_player(GameState *gs, const char *id);
Player *game_my_player(GameState *gs);
Enemy *game_find_enemy(GameState *gs, const char *id);

#endif
```

- [ ] **Step 2: Create game.c**

```c
// client/src/game.c
#include "game.h"
#include <string.h>
#include <stdio.h>
#include <math.h>

void game_init(GameState *gs) {
    memset(gs, 0, sizeof(*gs));
    gs->worldWidth = 1600;
    gs->worldHeight = 1200;
}

// === Lookup helpers ===

Player *game_find_player(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_PLAYERS; i++)
        if (gs->players[i].active && strcmp(gs->players[i].id, id) == 0)
            return &gs->players[i];
    return NULL;
}

static Player *game_alloc_player(GameState *gs) {
    for (int i = 0; i < MAX_PLAYERS; i++)
        if (!gs->players[i].active) return &gs->players[i];
    return NULL;
}

Player *game_my_player(GameState *gs) {
    return game_find_player(gs, gs->mySessionId);
}

Enemy *game_find_enemy(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_ENEMIES; i++)
        if (gs->enemies[i].active && strcmp(gs->enemies[i].id, id) == 0)
            return &gs->enemies[i];
    return NULL;
}

static Enemy *game_alloc_enemy(GameState *gs) {
    for (int i = 0; i < MAX_ENEMIES; i++)
        if (!gs->enemies[i].active) return &gs->enemies[i];
    return NULL;
}

static DroppedItem *find_drop(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_DROPS; i++)
        if (gs->drops[i].active && strcmp(gs->drops[i].id, id) == 0)
            return &gs->drops[i];
    return NULL;
}

static DroppedItem *alloc_drop(GameState *gs) {
    for (int i = 0; i < MAX_DROPS; i++)
        if (!gs->drops[i].active) return &gs->drops[i];
    return NULL;
}

static DroppedSpell *find_spell_drop(GameState *gs, const char *id) {
    for (int i = 0; i < MAX_SPELL_DROPS; i++)
        if (gs->spellDrops[i].active && strcmp(gs->spellDrops[i].id, id) == 0)
            return &gs->spellDrops[i];
    return NULL;
}

static DroppedSpell *alloc_spell_drop(GameState *gs) {
    for (int i = 0; i < MAX_SPELL_DROPS; i++)
        if (!gs->spellDrops[i].active) return &gs->spellDrops[i];
    return NULL;
}

static FloatingText *alloc_float_text(GameState *gs) {
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++)
        if (!gs->floatTexts[i].active) return &gs->floatTexts[i];
    return NULL;
}

static Projectile *alloc_projectile(GameState *gs) {
    for (int i = 0; i < MAX_PROJECTILES; i++)
        if (!gs->projectiles[i].active) return &gs->projectiles[i];
    return NULL;
}

static SpellEffect *alloc_spell_effect(GameState *gs) {
    for (int i = 0; i < MAX_SPELL_EFFECTS; i++)
        if (!gs->spellEffects[i].active) return &gs->spellEffects[i];
    return NULL;
}

static SwingEffect *alloc_swing(GameState *gs) {
    for (int i = 0; i < MAX_SWINGS; i++)
        if (!gs->swings[i].active) return &gs->swings[i];
    return NULL;
}

// === JSON helpers ===

static float jnum(cJSON *obj, const char *key, float def) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return v ? (float)v->valuedouble : def;
}

static int jint(cJSON *obj, const char *key, int def) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return v ? v->valueint : def;
}

static const char *jstr(cJSON *obj, const char *key) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return (v && v->valuestring) ? v->valuestring : "";
}

static bool jbool(cJSON *obj, const char *key) {
    cJSON *v = cJSON_GetObjectItem(obj, key);
    return v ? cJSON_IsTrue(v) : false;
}

// === Parse entity from JSON ===

static void parse_player(Player *p, cJSON *obj, bool full) {
    if (full) memset(p, 0, sizeof(*p));
    p->active = true;

    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(p->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "name"))) strncpy(p->name, v->valuestring, NAME_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) p->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) p->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "hp"))) p->hp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "maxHp"))) p->maxHp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "mana"))) p->mana = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "maxMana"))) p->maxMana = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "manaRegen"))) p->manaRegen = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "level"))) p->level = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "xp"))) p->xp = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "xpToNext"))) p->xpToNext = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "str"))) p->str = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "dex"))) p->dex = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "vit"))) p->vit = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "intel"))) p->intel = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "lck"))) p->lck = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "unspentPoints"))) p->unspentPoints = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "perkPoints"))) p->perkPoints = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "equippedWeaponType"))) p->equippedWeaponType = weapon_type_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "equippedWeaponRarity"))) p->equippedWeaponRarity = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "maxSpellSlots"))) p->maxSpellSlots = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "aimX"))) p->aimX = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "aimY"))) p->aimY = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "lastMoveX"))) p->lastMoveX = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "lastMoveY"))) p->lastMoveY = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "moveSpeed"))) p->moveSpeed = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "critChance"))) p->critChance = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "hpRegen"))) p->hpRegen = (float)v->valuedouble;

    // Inventory
    if ((v = cJSON_GetObjectItem(obj, "inventory"))) {
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n && i < MAX_INV_SLOTS; i++) {
            cJSON *slot = cJSON_GetArrayItem(v, i);
            p->inventory[i].weaponType = weapon_type_from_string(jstr(slot, "weaponType"));
            p->inventory[i].weaponRarity = jint(slot, "weaponRarity", -1);
        }
    }

    // Spell slots
    if ((v = cJSON_GetObjectItem(obj, "spellSlots"))) {
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n && i < MAX_SPELL_SLOTS; i++) {
            cJSON *slot = cJSON_GetArrayItem(v, i);
            p->spellSlots[i].spellId = spell_id_from_string(jstr(slot, "spellId"));
            p->spellSlots[i].spellRarity = jint(slot, "spellRarity", -1);
            p->spellSlots[i].cooldownLeft = jnum(slot, "cooldownLeft", 0);
        }
    }

    // Active skill nodes
    if ((v = cJSON_GetObjectItem(obj, "activeSkillNodes"))) {
        p->activeSkillNodeCount = 0;
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n && i < MAX_SKILL_NODES; i++) {
            cJSON *node = cJSON_GetArrayItem(v, i);
            if (node && node->valuestring) {
                strncpy(p->activeSkillNodes[i], node->valuestring, ID_LEN - 1);
                p->activeSkillNodeCount++;
            }
        }
    }
}

static void parse_enemy(Enemy *e, cJSON *obj, bool full) {
    if (full) memset(e, 0, sizeof(*e));
    e->active = true;
    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(e->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) e->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) e->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "hp"))) e->hp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "maxHp"))) e->maxHp = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "speed"))) e->speed = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "damage"))) e->damage = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "enemyType"))) e->enemyType = enemy_type_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "isBoss"))) e->isBoss = cJSON_IsTrue(v);
}

static void parse_drop(DroppedItem *d, cJSON *obj, bool full) {
    if (full) memset(d, 0, sizeof(*d));
    d->active = true;
    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(d->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) d->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) d->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "weaponType"))) d->weaponType = weapon_type_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "weaponRarity"))) d->weaponRarity = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "ttl"))) d->ttl = (float)v->valuedouble;
}

static void parse_spell_drop(DroppedSpell *s, cJSON *obj, bool full) {
    if (full) memset(s, 0, sizeof(*s));
    s->active = true;
    cJSON *v;
    if ((v = cJSON_GetObjectItem(obj, "id"))) strncpy(s->id, v->valuestring, ID_LEN - 1);
    if ((v = cJSON_GetObjectItem(obj, "x"))) s->x = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "y"))) s->y = (float)v->valuedouble;
    if ((v = cJSON_GetObjectItem(obj, "spellId"))) s->spellId = spell_id_from_string(v->valuestring);
    if ((v = cJSON_GetObjectItem(obj, "spellRarity"))) s->spellRarity = v->valueint;
    if ((v = cJSON_GetObjectItem(obj, "ttl"))) s->ttl = (float)v->valuedouble;
}

static void parse_float_text(FloatingText *ft, cJSON *obj) {
    memset(ft, 0, sizeof(*ft));
    ft->active = true;
    strncpy(ft->text, jstr(obj, "text"), sizeof(ft->text) - 1);
    ft->x = jnum(obj, "x", 0);
    ft->y = jnum(obj, "y", 0);
    ft->ttl = jnum(obj, "ttl", 1);
}

// === Process state_sync ===

static void handle_state_sync(GameState *gs, cJSON *root) {
    // Clear all entities
    for (int i = 0; i < MAX_PLAYERS; i++) gs->players[i].active = false;
    for (int i = 0; i < MAX_ENEMIES; i++) gs->enemies[i].active = false;
    for (int i = 0; i < MAX_DROPS; i++) gs->drops[i].active = false;
    for (int i = 0; i < MAX_SPELL_DROPS; i++) gs->spellDrops[i].active = false;
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++) gs->floatTexts[i].active = false;

    // Players
    cJSON *players = cJSON_GetObjectItem(root, "players");
    if (players) {
        cJSON *pj;
        cJSON_ArrayForEach(pj, players) {
            Player *p = game_alloc_player(gs);
            if (p) parse_player(p, pj, true);
        }
    }

    // Enemies
    cJSON *enemies = cJSON_GetObjectItem(root, "enemies");
    if (enemies) {
        cJSON *ej;
        cJSON_ArrayForEach(ej, enemies) {
            Enemy *e = game_alloc_enemy(gs);
            if (e) parse_enemy(e, ej, true);
        }
    }

    // Dropped items
    cJSON *drops = cJSON_GetObjectItem(root, "droppedItems");
    if (drops) {
        cJSON *dj;
        cJSON_ArrayForEach(dj, drops) {
            DroppedItem *d = alloc_drop(gs);
            if (d) parse_drop(d, dj, true);
        }
    }

    // Dropped spells
    cJSON *spells = cJSON_GetObjectItem(root, "droppedSpells");
    if (spells) {
        cJSON *sj;
        cJSON_ArrayForEach(sj, spells) {
            DroppedSpell *s = alloc_spell_drop(gs);
            if (s) parse_spell_drop(s, sj, true);
        }
    }

    // Floating texts
    cJSON *texts = cJSON_GetObjectItem(root, "floatingTexts");
    if (texts) {
        cJSON *tj;
        cJSON_ArrayForEach(tj, texts) {
            FloatingText *ft = alloc_float_text(gs);
            if (ft) parse_float_text(ft, tj);
        }
    }

    // Wave
    cJSON *wave = cJSON_GetObjectItem(root, "wave");
    if (wave) {
        gs->wave.waveNumber = jint(wave, "waveNumber", 0);
        gs->wave.state = wave_state_from_string(jstr(wave, "state"));
        gs->wave.timer = jnum(wave, "timer", 0);
        gs->wave.enemiesRemaining = jint(wave, "enemiesRemaining", 0);
    }

    gs->connected = true;
}

// === Process state_patch ===

static void handle_state_patch(GameState *gs, cJSON *root) {
    // Players
    cJSON *players = cJSON_GetObjectItem(root, "players");
    if (players) {
        cJSON *pj;
        cJSON_ArrayForEach(pj, players) {
            const char *id = pj->string;
            if (cJSON_IsNull(pj)) {
                Player *p = game_find_player(gs, id);
                if (p) p->active = false;
            } else {
                Player *p = game_find_player(gs, id);
                if (!p) { p = game_alloc_player(gs); if (!p) continue; }
                parse_player(p, pj, p->id[0] == '\0');
                if (p->id[0] == '\0') strncpy(p->id, id, ID_LEN - 1);
            }
        }
    }

    // Enemies
    cJSON *enemies = cJSON_GetObjectItem(root, "enemies");
    if (enemies) {
        cJSON *ej;
        cJSON_ArrayForEach(ej, enemies) {
            const char *id = ej->string;
            if (cJSON_IsNull(ej)) {
                Enemy *e = game_find_enemy(gs, id);
                if (e) e->active = false;
            } else {
                Enemy *e = game_find_enemy(gs, id);
                if (!e) { e = game_alloc_enemy(gs); if (!e) continue; }
                parse_enemy(e, ej, e->id[0] == '\0');
                if (e->id[0] == '\0') strncpy(e->id, id, ID_LEN - 1);
            }
        }
    }

    // Dropped items
    cJSON *drops = cJSON_GetObjectItem(root, "droppedItems");
    if (drops) {
        cJSON *dj;
        cJSON_ArrayForEach(dj, drops) {
            const char *id = dj->string;
            if (cJSON_IsNull(dj)) {
                DroppedItem *d = find_drop(gs, id);
                if (d) d->active = false;
            } else {
                DroppedItem *d = find_drop(gs, id);
                if (!d) { d = alloc_drop(gs); if (!d) continue; }
                parse_drop(d, dj, d->id[0] == '\0');
                if (d->id[0] == '\0') strncpy(d->id, id, ID_LEN - 1);
            }
        }
    }

    // Dropped spells
    cJSON *spellDrops = cJSON_GetObjectItem(root, "droppedSpells");
    if (spellDrops) {
        cJSON *sj;
        cJSON_ArrayForEach(sj, spellDrops) {
            const char *id = sj->string;
            if (cJSON_IsNull(sj)) {
                DroppedSpell *s = find_spell_drop(gs, id);
                if (s) s->active = false;
            } else {
                DroppedSpell *s = find_spell_drop(gs, id);
                if (!s) { s = alloc_spell_drop(gs); if (!s) continue; }
                parse_spell_drop(s, sj, s->id[0] == '\0');
                if (s->id[0] == '\0') strncpy(s->id, id, ID_LEN - 1);
            }
        }
    }

    // Floating texts
    cJSON *texts = cJSON_GetObjectItem(root, "floatingTexts");
    if (texts) {
        cJSON *tj;
        cJSON_ArrayForEach(tj, texts) {
            const char *id = tj->string;
            if (cJSON_IsNull(tj)) {
                // Find and deactivate by matching — floatingTexts don't have IDs in struct
                // Just let them expire naturally
            } else {
                FloatingText *ft = alloc_float_text(gs);
                if (ft) parse_float_text(ft, tj);
            }
        }
    }

    // Wave
    cJSON *wave = cJSON_GetObjectItem(root, "wave");
    if (wave) {
        cJSON *v;
        if ((v = cJSON_GetObjectItem(wave, "waveNumber"))) gs->wave.waveNumber = v->valueint;
        if ((v = cJSON_GetObjectItem(wave, "state"))) gs->wave.state = wave_state_from_string(v->valuestring);
        if ((v = cJSON_GetObjectItem(wave, "timer"))) gs->wave.timer = (float)v->valuedouble;
        if ((v = cJSON_GetObjectItem(wave, "enemiesRemaining"))) gs->wave.enemiesRemaining = v->valueint;
    }
}

// === Process events ===

static void handle_event(GameState *gs, cJSON *root) {
    const char *event = jstr(root, "event");
    cJSON *data = cJSON_GetObjectItem(root, "data");
    if (!data) return;

    if (strcmp(event, "projectile_fired") == 0) {
        Projectile *p = alloc_projectile(gs);
        if (!p) return;
        memset(p, 0, sizeof(*p));
        p->active = true;
        strncpy(p->id, jstr(data, "id"), ID_LEN - 1);
        p->x = jnum(data, "x", 0);
        p->y = jnum(data, "y", 0);
        p->dx = jnum(data, "dx", 0);
        p->dy = jnum(data, "dy", 0);
        p->speed = jnum(data, "speed", 500);
        p->isEnemy = jbool(data, "isEnemy");
        p->type = weapon_type_from_string(jstr(data, "type"));
        p->lifetime = 3.0f;
    }
    else if (strcmp(event, "projectile_hit") == 0) {
        const char *id = jstr(data, "id");
        for (int i = 0; i < MAX_PROJECTILES; i++) {
            if (gs->projectiles[i].active && strcmp(gs->projectiles[i].id, id) == 0) {
                gs->projectiles[i].active = false;
                break;
            }
        }
    }
    else if (strcmp(event, "swing") == 0) {
        SwingEffect *sw = alloc_swing(gs);
        if (!sw) return;
        sw->active = true;
        sw->x = jnum(data, "x", 0);
        sw->y = jnum(data, "y", 0);
        sw->dx = jnum(data, "dx", 0);
        sw->dy = jnum(data, "dy", 0);
        sw->ttl = 0.15f;
        sw->weaponType = weapon_type_from_string(jstr(data, "weaponType"));
    }
    else if (strcmp(event, "explosion") == 0) {
        SpellEffect *se = alloc_spell_effect(gs);
        if (!se) return;
        memset(se, 0, sizeof(*se));
        se->active = true;
        se->spellId = -1; // generic explosion
        se->x = jnum(data, "x", 0);
        se->y = jnum(data, "y", 0);
        se->radius = jnum(data, "radius", 100);
        se->ttl = 0.3f;
    }
    else if (strcmp(event, "spell_cast") == 0) {
        SpellEffect *se = alloc_spell_effect(gs);
        if (!se) return;
        memset(se, 0, sizeof(*se));
        se->active = true;
        strncpy(se->id, jstr(data, "effectId"), ID_LEN - 1);
        se->spellId = spell_id_from_string(jstr(data, "spellId"));
        se->x = jnum(data, "x", 0);
        se->y = jnum(data, "y", 0);
        se->radius = 60; // default
        se->ttl = 5.0f;

        // Projectile spells also spawn a projectile
        if (se->spellId == SPELL_FIREBALL || se->spellId == SPELL_ICE_RAY) {
            Projectile *p = alloc_projectile(gs);
            if (p) {
                memset(p, 0, sizeof(*p));
                p->active = true;
                strncpy(p->id, se->id, ID_LEN - 1);
                p->x = jnum(data, "x", 0);
                p->y = jnum(data, "y", 0);
                p->dx = jnum(data, "dx", 0);
                p->dy = jnum(data, "dy", 0);
                p->speed = (se->spellId == SPELL_FIREBALL) ? 450.0f : 500.0f;
                p->isEnemy = false;
                p->type = -1; // spell projectile
                p->lifetime = 3.0f;
            }
            se->active = false; // no lingering effect for projectile spells
        }
    }
    else if (strcmp(event, "spell_effect") == 0) {
        // Update existing spell effect (e.g., meteor impact)
        SpellEffect *se = alloc_spell_effect(gs);
        if (!se) return;
        memset(se, 0, sizeof(*se));
        se->active = true;
        se->spellId = spell_id_from_string(jstr(data, "spellId"));
        se->x = jnum(data, "x", 0);
        se->y = jnum(data, "y", 0);
        se->radius = jnum(data, "radius", 60);
        se->ttl = 0.5f;
    }
    else if (strcmp(event, "spell_end") == 0) {
        const char *effectId = jstr(data, "effectId");
        for (int i = 0; i < MAX_SPELL_EFFECTS; i++) {
            if (gs->spellEffects[i].active && strcmp(gs->spellEffects[i].id, effectId) == 0) {
                gs->spellEffects[i].active = false;
                break;
            }
        }
    }
    // Other events (level_up, wave_start, etc.) are informational
    // State changes come through patches
}

// === Main message router ===

void game_process_message(GameState *gs, const char *json_str) {
    cJSON *root = cJSON_Parse(json_str);
    if (!root) return;

    const char *type = jstr(root, "type");
    ServerMsgType mt = server_msg_type(type);

    switch (mt) {
    case MSG_IDENTITY:
        strncpy(gs->mySessionId, jstr(root, "sessionId"), ID_LEN - 1);
        break;
    case MSG_STATE_SYNC:
        handle_state_sync(gs, root);
        break;
    case MSG_STATE_PATCH:
        handle_state_patch(gs, root);
        break;
    case MSG_EVENT:
        handle_event(gs, root);
        break;
    default:
        break;
    }

    cJSON_Delete(root);
}

// === Per-frame update ===

void game_update(GameState *gs, float dt) {
    // Update projectiles
    for (int i = 0; i < MAX_PROJECTILES; i++) {
        Projectile *p = &gs->projectiles[i];
        if (!p->active) continue;
        p->x += p->dx * p->speed * dt;
        p->y += p->dy * p->speed * dt;
        p->lifetime -= dt;
        if (p->lifetime <= 0 || p->x < 0 || p->x > gs->worldWidth ||
            p->y < 0 || p->y > gs->worldHeight) {
            p->active = false;
        }
    }

    // Update floating texts
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++) {
        FloatingText *ft = &gs->floatTexts[i];
        if (!ft->active) continue;
        ft->y -= 18.0f * dt;
        ft->ttl -= dt;
        if (ft->ttl <= 0) ft->active = false;
    }

    // Update spell effects
    for (int i = 0; i < MAX_SPELL_EFFECTS; i++) {
        SpellEffect *se = &gs->spellEffects[i];
        if (!se->active) continue;
        se->ttl -= dt;
        if (se->ttl <= 0) se->active = false;
    }

    // Update swing effects
    for (int i = 0; i < MAX_SWINGS; i++) {
        SwingEffect *sw = &gs->swings[i];
        if (!sw->active) continue;
        sw->ttl -= dt;
        if (sw->ttl <= 0) sw->active = false;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game.c client/src/game.h
git commit -m "feat: add game state management with state_sync, state_patch, and event handling"
```

### Task 7: input.c/h — keyboard, mouse, rate-limited message generation

**Files:**
- Create: `client/src/input.h`
- Create: `client/src/input.c`

- [ ] **Step 1: Create input.h and input.c**

`input.h`:
```c
#ifndef INPUT_H
#define INPUT_H

#include "game.h"
#include "network.h"
#include <stdbool.h>

typedef struct {
    bool showAttributes;
    bool showSkillTree;
    int selectedSkillNode;  // index into skill tree node list, -1 = none
} InputState;

void input_init(InputState *is);
void input_update(InputState *is, GameState *gs, NetworkContext *net, float screenW, float screenH);

#endif
```

`input.c`:
```c
#include "input.h"
#include "protocol.h"
#include <raylib.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

void input_init(InputState *is) {
    memset(is, 0, sizeof(*is));
    is->selectedSkillNode = -1;
}

void input_update(InputState *is, GameState *gs, NetworkContext *net, float screenW, float screenH) {
    Player *me = game_my_player(gs);
    if (!me) return;

    static double lastMoveSend = 0;
    static double lastAimSend = 0;
    double now = GetTime();

    // === Movement (WASD) ===
    float mx = 0, my = 0;
    if (IsKeyDown(KEY_W)) my -= 1;
    if (IsKeyDown(KEY_S)) my += 1;
    if (IsKeyDown(KEY_A)) mx -= 1;
    if (IsKeyDown(KEY_D)) mx += 1;

    float len = sqrtf(mx * mx + my * my);
    if (len > 0) { mx /= len; my /= len; }

    if (now - lastMoveSend >= 0.05) { // 20/s
        char *msg = msg_move(mx, my);
        net_send(net, msg);
        free(msg);
        lastMoveSend = now;
    }

    // === Aim (mouse) ===
    if (now - lastAimSend >= 0.066) { // ~15/s
        float mouseX = GetMouseX() - screenW / 2.0f;
        float mouseY = GetMouseY() - screenH / 2.0f;
        float aimLen = sqrtf(mouseX * mouseX + mouseY * mouseY);
        if (aimLen > 0) {
            char *msg = msg_aim(mouseX / aimLen, mouseY / aimLen);
            net_send(net, msg);
            free(msg);
        }
        lastAimSend = now;
    }

    // === Attack (Space) ===
    if (IsKeyPressed(KEY_SPACE)) {
        char *msg = msg_attack();
        net_send(net, msg);
        free(msg);
    }

    // === Pickup item (E) ===
    if (IsKeyPressed(KEY_E)) {
        // Find closest drop in range
        float bestDist = 40.0f;
        DroppedItem *best = NULL;
        for (int i = 0; i < MAX_DROPS; i++) {
            if (!gs->drops[i].active) continue;
            float dx = gs->drops[i].x - me->x;
            float dy = gs->drops[i].y - me->y;
            float dist = sqrtf(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; best = &gs->drops[i]; }
        }
        if (best) {
            char *msg = msg_pickup_item(best->id);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Pickup spell (F) ===
    if (IsKeyPressed(KEY_F)) {
        float bestDist = 40.0f;
        DroppedSpell *best = NULL;
        for (int i = 0; i < MAX_SPELL_DROPS; i++) {
            if (!gs->spellDrops[i].active) continue;
            float dx = gs->spellDrops[i].x - me->x;
            float dy = gs->spellDrops[i].y - me->y;
            float dist = sqrtf(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; best = &gs->spellDrops[i]; }
        }
        if (best) {
            char *msg = msg_pickup_spell(best->id);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Drop weapon (Q) ===
    if (IsKeyPressed(KEY_Q)) {
        char *msg = msg_drop_weapon();
        net_send(net, msg);
        free(msg);
    }

    // === Swap weapon (1-5) ===
    for (int i = 0; i < 5; i++) {
        if (IsKeyPressed(KEY_ONE + i)) {
            char *msg = msg_swap_weapon(i);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Cast spells (Z X C V B) ===
    int spellKeys[] = { KEY_Z, KEY_X, KEY_C, KEY_V, KEY_B };
    for (int i = 0; i < 5; i++) {
        if (IsKeyPressed(spellKeys[i]) && i < me->maxSpellSlots) {
            float mouseWorldX = GetMouseX() - screenW / 2.0f + me->x;
            float mouseWorldY = GetMouseY() - screenH / 2.0f + me->y;
            char *msg = msg_cast_spell(i, mouseWorldX, mouseWorldY);
            net_send(net, msg);
            free(msg);
        }
    }

    // === Toggle panels ===
    if (IsKeyPressed(KEY_P)) is->showAttributes = !is->showAttributes;
    if (IsKeyPressed(KEY_T)) is->showSkillTree = !is->showSkillTree;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/input.c client/src/input.h
git commit -m "feat: add input handling with rate-limited movement and aim"
```

### Task 8: render.c/h — world rendering

**Files:**
- Create: `client/src/render.h`
- Create: `client/src/render.c`

- [ ] **Step 1: Create render.h and render.c**

`render.h`:
```c
#ifndef RENDER_H
#define RENDER_H

#include "game.h"
#include <raylib.h>

typedef struct {
    float offsetX, offsetY;
} Camera2DState;

void render_update_camera(Camera2DState *cam, GameState *gs, float screenW, float screenH);
void render_world(Camera2DState *cam, GameState *gs);

// Rarity color helper
Color rarity_color(int rarity);

#endif
```

`render.c`:
```c
#include "render.h"
#include <math.h>
#include <string.h>
#include <stdio.h>

static Color BG_COLOR = { 30, 30, 46, 255 };
static Color GRID_COLOR = { 50, 50, 70, 255 };

Color rarity_color(int rarity) {
    switch (rarity) {
        case 0: return WHITE;
        case 1: return (Color){ 74, 222, 128, 255 };
        case 2: return (Color){ 96, 165, 250, 255 };
        case 3: return (Color){ 192, 132, 252, 255 };
        case 4: return (Color){ 251, 191, 36, 255 };
        default: return GRAY;
    }
}

static float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

void render_update_camera(Camera2DState *cam, GameState *gs, float screenW, float screenH) {
    Player *me = game_my_player(gs);
    if (!me) return;
    cam->offsetX = clampf(screenW / 2.0f - me->x, screenW - gs->worldWidth, 0);
    cam->offsetY = clampf(screenH / 2.0f - me->y, screenH - gs->worldHeight, 0);
}

void render_world(Camera2DState *cam, GameState *gs) {
    float ox = cam->offsetX, oy = cam->offsetY;

    // Background
    DrawRectangle((int)ox, (int)oy, gs->worldWidth, gs->worldHeight, BG_COLOR);

    // Grid
    for (int x = 0; x <= gs->worldWidth; x += 50)
        DrawLine((int)(ox + x), (int)oy, (int)(ox + x), (int)(oy + gs->worldHeight), GRID_COLOR);
    for (int y = 0; y <= gs->worldHeight; y += 50)
        DrawLine((int)ox, (int)(oy + y), (int)(ox + gs->worldWidth), (int)(oy + y), GRID_COLOR);

    // Dropped items (diamond)
    for (int i = 0; i < MAX_DROPS; i++) {
        DroppedItem *d = &gs->drops[i];
        if (!d->active) continue;
        Color c = rarity_color(d->weaponRarity);
        Vector2 center = { ox + d->x, oy + d->y };
        DrawPoly(center, 4, 8, 45, c);
    }

    // Dropped spells (circle)
    for (int i = 0; i < MAX_SPELL_DROPS; i++) {
        DroppedSpell *s = &gs->spellDrops[i];
        if (!s->active) continue;
        Color c = rarity_color(s->spellRarity);
        DrawCircle((int)(ox + s->x), (int)(oy + s->y), 7, c);
        DrawCircleLines((int)(ox + s->x), (int)(oy + s->y), 10, Fade(c, 0.5f));
    }

    // Enemies
    for (int i = 0; i < MAX_ENEMIES; i++) {
        Enemy *e = &gs->enemies[i];
        if (!e->active) continue;
        float r = e->isBoss ? 18.0f : 12.0f;
        Color c = e->isBoss ? ORANGE : RED;
        DrawCircle((int)(ox + e->x), (int)(oy + e->y), r, c);
        // HP bar
        float barW = r * 2.0f;
        float hpRatio = e->maxHp > 0 ? e->hp / e->maxHp : 0;
        DrawRectangle((int)(ox + e->x - barW/2), (int)(oy + e->y - r - 8), (int)barW, 4, DARKGRAY);
        DrawRectangle((int)(ox + e->x - barW/2), (int)(oy + e->y - r - 8), (int)(barW * hpRatio), 4, RED);
    }

    // Players
    for (int i = 0; i < MAX_PLAYERS; i++) {
        Player *p = &gs->players[i];
        if (!p->active) continue;
        bool isMe = (strcmp(p->id, gs->mySessionId) == 0);
        Color c = isMe ? (Color){ 74, 222, 128, 255 } : (Color){ 96, 165, 250, 255 };
        DrawCircle((int)(ox + p->x), (int)(oy + p->y), 16, c);
        // Name
        int nameW = MeasureText(p->name, 10);
        DrawText(p->name, (int)(ox + p->x - nameW/2), (int)(oy + p->y - 28), 10, WHITE);
        // HP bar
        float hpRatio = p->maxHp > 0 ? p->hp / p->maxHp : 0;
        DrawRectangle((int)(ox + p->x - 16), (int)(oy + p->y - 22), 32, 4, DARKGRAY);
        DrawRectangle((int)(ox + p->x - 16), (int)(oy + p->y - 22), (int)(32 * hpRatio), 4, (Color){239,68,68,255});
    }

    // Projectiles
    for (int i = 0; i < MAX_PROJECTILES; i++) {
        Projectile *p = &gs->projectiles[i];
        if (!p->active) continue;
        Color c = p->isEnemy ? RED : YELLOW;
        DrawCircle((int)(ox + p->x), (int)(oy + p->y), 4, c);
    }

    // Spell effects
    for (int i = 0; i < MAX_SPELL_EFFECTS; i++) {
        SpellEffect *se = &gs->spellEffects[i];
        if (!se->active) continue;
        Color c = Fade(PURPLE, 0.3f);
        DrawCircle((int)(ox + se->x), (int)(oy + se->y), se->radius, c);
        DrawCircleLines((int)(ox + se->x), (int)(oy + se->y), se->radius, Fade(PURPLE, 0.6f));
    }

    // Swing effects
    for (int i = 0; i < MAX_SWINGS; i++) {
        SwingEffect *sw = &gs->swings[i];
        if (!sw->active) continue;
        float angle = atan2f(sw->dy, sw->dx);
        float r = 40.0f;
        Color c = Fade(WHITE, sw->ttl / 0.15f);
        DrawCircleSector(
            (Vector2){ ox + sw->x, oy + sw->y },
            r, (angle - 0.5f) * RAD2DEG, (angle + 0.5f) * RAD2DEG, 8, c
        );
    }

    // Floating text
    for (int i = 0; i < MAX_FLOAT_TEXTS; i++) {
        FloatingText *ft = &gs->floatTexts[i];
        if (!ft->active) continue;
        float alpha = ft->ttl > 0.5f ? 1.0f : ft->ttl * 2.0f;
        Color c = Fade(WHITE, alpha);
        int w = MeasureText(ft->text, 14);
        DrawText(ft->text, (int)(ox + ft->x - w/2), (int)(oy + ft->y), 14, c);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/render.c client/src/render.h
git commit -m "feat: add world rendering with camera, entities, projectiles, effects"
```

### Task 9: ui.c/h — HUD, inventory, spell bar, overlays

**Files:**
- Create: `client/src/ui.h`
- Create: `client/src/ui.c`

- [ ] **Step 1: Create ui.h and ui.c**

`ui.h`:
```c
#ifndef UI_H
#define UI_H

#include "game.h"
#include "input.h"
#include "network.h"
#include "render.h"

void ui_draw(GameState *gs, InputState *is, NetworkContext *net, float screenW, float screenH);

#endif
```

`ui.c` — implements HUD bars, inventory, spell bar, attribute panel, and skill tree overlay. Key sections:

```c
#include "ui.h"
#include "protocol.h"
#include <raylib.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

// === Skill tree data (hardcoded from server's SkillTree.ts) ===

typedef struct {
    const char *id;
    const char *name;
    const char *region; // "combat","defense","utility","center","major"
    int cost;
    float px, py;
    const char *connections[4]; // max 4 connections
    int numConnections;
} SkillNodeDef;

static const SkillNodeDef SKILL_NODES[] = {
    {"center","Origin","center",0,0.5f,0.5f,{"c1","d1","u1"},3},
    {"c1","Sharpness I","combat",1,0.38f,0.42f,{"center","c2","c3"},3},
    {"c2","Precision I","combat",1,0.28f,0.35f,{"c1","c4","c5"},3},
    {"c3","Swift Strikes","combat",1,0.42f,0.32f,{"c1","c6","mc1"},3},
    {"c4","Sharpness II","combat",1,0.2f,0.28f,{"c2","c7"},2},
    {"c5","Precision II","combat",1,0.3f,0.22f,{"c2","c7","c8"},3},
    {"c6","Ferocity","combat",1,0.45f,0.2f,{"c3","c8","c9"},3},
    {"c7","Devastation","combat",1,0.22f,0.15f,{"c4","c5","c10"},3},
    {"c8","Devastating Crit","combat",1,0.35f,0.12f,{"c5","c6","c10"},3},
    {"c9","Double Strike","combat",1,0.5f,0.1f,{"c6","c11"},2},
    {"c10","Sharpness III","combat",1,0.28f,0.05f,{"c7","c8","c11"},3},
    {"c11","Vampirism","combat",1,0.42f,0.03f,{"c9","c10"},2},
    {"d1","Toughness I","defense",1,0.38f,0.58f,{"center","d2","d3"},3},
    {"d2","Regeneration I","defense",1,0.28f,0.65f,{"d1","d4","d5"},3},
    {"d3","Thick Skin","defense",1,0.42f,0.68f,{"d1","d6","mc1"},3},
    {"d4","Toughness II","defense",1,0.2f,0.72f,{"d2","d7"},2},
    {"d5","Regeneration II","defense",1,0.3f,0.78f,{"d2","d7","d8"},3},
    {"d6","Iron Will","defense",1,0.45f,0.8f,{"d3","d8","d9"},3},
    {"d7","Toughness III","defense",1,0.22f,0.85f,{"d4","d5","d10"},3},
    {"d8","Kill Shield","defense",1,0.35f,0.88f,{"d5","d6","d10"},3},
    {"d9","Fortitude","defense",1,0.52f,0.88f,{"d6","d11","mc2"},3},
    {"d10","Regeneration III","defense",1,0.28f,0.95f,{"d7","d8","d11"},3},
    {"d11","Second Chance","defense",1,0.42f,0.97f,{"d9","d10"},2},
    {"u1","Swiftness I","utility",1,0.62f,0.5f,{"center","u2","u3"},3},
    {"u2","Collector I","utility",1,0.72f,0.42f,{"u1","u4","u5"},3},
    {"u3","Fortune I","utility",1,0.68f,0.58f,{"u1","u6","mc2"},3},
    {"u4","Swiftness II","utility",1,0.8f,0.35f,{"u2","u7"},2},
    {"u5","Scholar I","utility",1,0.78f,0.48f,{"u2","u7","u8"},3},
    {"u6","Fortune II","utility",1,0.75f,0.65f,{"u3","u8","u9"},3},
    {"u7","Swiftness III","utility",1,0.88f,0.4f,{"u4","u5","u10"},3},
    {"u8","Lucky Drops","utility",1,0.85f,0.55f,{"u5","u6","u10"},3},
    {"u9","War Aura","utility",1,0.78f,0.75f,{"u6","u11"},2},
    {"u10","Scholar II","utility",1,0.92f,0.5f,{"u7","u8","u11"},3},
    {"u11","Collector II","utility",1,0.9f,0.68f,{"u9","u10"},2},
    {"mc1","Berserker","major",2,0.45f,0.5f,{"c3","d3"},2},
    {"mc2","Scavenger","major",2,0.6f,0.72f,{"d9","u3"},2},
};
#define NUM_SKILL_NODES 36

static bool is_node_active(Player *p, const char *nodeId) {
    for (int i = 0; i < p->activeSkillNodeCount; i++)
        if (strcmp(p->activeSkillNodes[i], nodeId) == 0) return true;
    return false;
}

static bool is_node_available(Player *p, const char *nodeId) {
    for (int n = 0; n < NUM_SKILL_NODES; n++) {
        if (strcmp(SKILL_NODES[n].id, nodeId) != 0) continue;
        for (int c = 0; c < SKILL_NODES[n].numConnections; c++) {
            if (is_node_active(p, SKILL_NODES[n].connections[c])) return true;
        }
        break;
    }
    return false;
}

static int find_node_index(const char *id) {
    for (int i = 0; i < NUM_SKILL_NODES; i++)
        if (strcmp(SKILL_NODES[i].id, id) == 0) return i;
    return -1;
}

// === Draw helpers ===

static void draw_bar(float x, float y, float w, float h, float ratio, Color fg, Color bg) {
    DrawRectangle((int)x, (int)y, (int)w, (int)h, bg);
    DrawRectangle((int)x, (int)y, (int)(w * ratio), (int)h, fg);
    DrawRectangleLines((int)x, (int)y, (int)w, (int)h, Fade(WHITE, 0.3f));
}

// === Main UI draw ===

void ui_draw(GameState *gs, InputState *is, NetworkContext *net, float screenW, float screenH) {
    Player *me = game_my_player(gs);
    if (!me) {
        const char *txt = "Connecting...";
        DrawText(txt, (int)(screenW/2 - MeasureText(txt,20)/2), (int)(screenH/2), 20, WHITE);
        return;
    }

    // === Top HUD ===
    // HP bar
    float hpRatio = me->maxHp > 0 ? me->hp / me->maxHp : 0;
    draw_bar(10, 10, 200, 16, hpRatio, (Color){239,68,68,255}, (Color){60,20,20,255});
    char buf[64];
    snprintf(buf, sizeof(buf), "HP %.0f/%.0f", me->hp, me->maxHp);
    DrawText(buf, 14, 11, 12, WHITE);

    // Mana bar
    float manaRatio = me->maxMana > 0 ? me->mana / me->maxMana : 0;
    draw_bar(10, 30, 200, 16, manaRatio, (Color){96,165,250,255}, (Color){20,20,60,255});
    snprintf(buf, sizeof(buf), "MP %.0f/%.0f", me->mana, me->maxMana);
    DrawText(buf, 14, 31, 12, WHITE);

    // Level + XP
    float xpRatio = me->xpToNext > 0 ? (float)me->xp / me->xpToNext : 0;
    snprintf(buf, sizeof(buf), "Lv.%d", me->level);
    DrawText(buf, 220, 11, 14, YELLOW);
    draw_bar(220, 30, 120, 12, xpRatio, (Color){168,85,247,255}, (Color){40,20,60,255});
    snprintf(buf, sizeof(buf), "XP %d/%d", me->xp, me->xpToNext);
    DrawText(buf, 224, 30, 10, WHITE);

    // Wave info
    const char *waveStates[] = {"WAITING","COMBAT","PAUSE"};
    int ws = me ? gs->wave.state : 0;
    snprintf(buf, sizeof(buf), "Wave %d  %s", gs->wave.waveNumber, waveStates[ws]);
    DrawText(buf, (int)(screenW - 200), 11, 14, WHITE);
    if (gs->wave.enemiesRemaining > 0) {
        snprintf(buf, sizeof(buf), "Enemies: %d", gs->wave.enemiesRemaining);
        DrawText(buf, (int)(screenW - 200), 30, 12, LIGHTGRAY);
    }

    // === Bottom: Inventory bar ===
    float invStartX = 10;
    float invY = screenH - 50;
    for (int i = 0; i < MAX_INV_SLOTS; i++) {
        float x = invStartX + i * 70;
        Color border = (me->inventory[i].weaponRarity >= 0)
            ? rarity_color(me->inventory[i].weaponRarity) : DARKGRAY;
        DrawRectangle((int)x, (int)invY, 60, 40, (Color){30,30,50,200});
        DrawRectangleLines((int)x, (int)invY, 60, 40, border);
        snprintf(buf, sizeof(buf), "%d", i + 1);
        DrawText(buf, (int)x + 2, (int)invY + 2, 10, GRAY);
        if (me->inventory[i].weaponRarity >= 0) {
            DrawText(weapon_type_to_string(me->inventory[i].weaponType),
                     (int)x + 4, (int)invY + 14, 10, border);
        }
    }

    // === Bottom center: Spell bar ===
    const char *spellKeys = "ZXCVB";
    float spellStartX = screenW / 2 - (5 * 70) / 2;
    float spellY = screenH - 50;
    for (int i = 0; i < MAX_SPELL_SLOTS; i++) {
        float x = spellStartX + i * 70;
        bool locked = i >= me->maxSpellSlots;
        bool hasSpell = me->spellSlots[i].spellRarity >= 0;
        Color border = locked ? (Color){40,40,40,255}
                     : hasSpell ? rarity_color(me->spellSlots[i].spellRarity) : DARKGRAY;
        DrawRectangle((int)x, (int)spellY, 60, 40, (Color){30,30,50,200});
        DrawRectangleLines((int)x, (int)spellY, 60, 40, border);
        snprintf(buf, sizeof(buf), "%c", spellKeys[i]);
        DrawText(buf, (int)x + 2, (int)spellY + 2, 10, GRAY);
        if (hasSpell && !locked) {
            DrawText(spell_id_to_string(me->spellSlots[i].spellId),
                     (int)x + 4, (int)spellY + 14, 9, border);
            // Cooldown overlay
            if (me->spellSlots[i].cooldownLeft > 0) {
                float cdRatio = me->spellSlots[i].cooldownLeft / 10.0f; // rough
                DrawRectangle((int)x, (int)spellY, 60, (int)(40 * cdRatio), Fade(BLACK, 0.6f));
                snprintf(buf, sizeof(buf), "%.1f", me->spellSlots[i].cooldownLeft);
                DrawText(buf, (int)x + 20, (int)spellY + 14, 10, WHITE);
            }
        }
    }

    // === Attribute panel (P key) ===
    if (is->showAttributes) {
        float px = 10, py = 60;
        DrawRectangle((int)px, (int)py, 220, 220, (Color){20,20,30,230});
        DrawRectangleLines((int)px, (int)py, 220, 220, GRAY);
        snprintf(buf, sizeof(buf), "Attributes (%d pts)", me->unspentPoints);
        DrawText(buf, (int)px + 8, (int)py + 8, 14, YELLOW);

        const char *names[] = {"STR","DEX","VIT","INT","LCK"};
        int *vals[] = {&me->str, &me->dex, &me->vit, &me->intel, &me->lck};
        for (int i = 0; i < 5; i++) {
            float row = py + 30 + i * 24;
            snprintf(buf, sizeof(buf), "%s: %d", names[i], *vals[i]);
            DrawText(buf, (int)px + 12, (int)row, 12, WHITE);
            // [+] button
            if (me->unspentPoints > 0) {
                Rectangle btn = { px + 160, row - 2, 24, 18 };
                DrawRectangleRec(btn, (Color){60,60,80,255});
                DrawText("+", (int)btn.x + 8, (int)btn.y + 2, 12, GREEN);
                if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT) && CheckCollisionPointRec(GetMousePosition(), btn)) {
                    int pts[5] = {0,0,0,0,0};
                    pts[i] = 1;
                    char *msg = msg_allocate_points(pts[0], pts[1], pts[2], pts[3], pts[4]);
                    net_send(net, msg);
                    free(msg);
                }
            }
        }

        // Derived stats
        float dy = py + 160;
        snprintf(buf, sizeof(buf), "HP Regen: %.1f/s", me->hpRegen);
        DrawText(buf, (int)px + 12, (int)dy, 10, LIGHTGRAY);
        snprintf(buf, sizeof(buf), "Move Speed: %.0f", me->moveSpeed);
        DrawText(buf, (int)px + 12, (int)dy + 14, 10, LIGHTGRAY);
        snprintf(buf, sizeof(buf), "Crit: %.1f%%", me->critChance);
        DrawText(buf, (int)px + 12, (int)dy + 28, 10, LIGHTGRAY);
    }

    // === Skill tree (T key) ===
    if (is->showSkillTree) {
        float treeW = 500, treeH = 500;
        float tx = (screenW - treeW) / 2;
        float ty = (screenH - treeH) / 2;
        DrawRectangle((int)tx, (int)ty, (int)treeW, (int)treeH, (Color){15,15,25,240});
        DrawRectangleLines((int)tx, (int)ty, (int)treeW, (int)treeH, GRAY);
        snprintf(buf, sizeof(buf), "Skill Tree (Perk Points: %d)", me->perkPoints);
        DrawText(buf, (int)tx + 10, (int)ty + 8, 14, YELLOW);

        // Draw connections first
        for (int i = 0; i < NUM_SKILL_NODES; i++) {
            float x1 = tx + SKILL_NODES[i].px * treeW;
            float y1 = ty + SKILL_NODES[i].py * treeH;
            for (int c = 0; c < SKILL_NODES[i].numConnections; c++) {
                int j = find_node_index(SKILL_NODES[i].connections[c]);
                if (j < 0 || j <= i) continue; // avoid double draw
                float x2 = tx + SKILL_NODES[j].px * treeW;
                float y2 = ty + SKILL_NODES[j].py * treeH;
                DrawLine((int)x1, (int)y1, (int)x2, (int)y2, Fade(GRAY, 0.4f));
            }
        }

        // Draw nodes
        for (int i = 0; i < NUM_SKILL_NODES; i++) {
            float nx = tx + SKILL_NODES[i].px * treeW;
            float ny = ty + SKILL_NODES[i].py * treeH;
            float r = (SKILL_NODES[i].cost == 2) ? 14.0f : 10.0f;

            bool active = is_node_active(me, SKILL_NODES[i].id);
            bool available = !active && is_node_available(me, SKILL_NODES[i].id);

            Color fill, border;
            if (active) {
                if (strcmp(SKILL_NODES[i].region, "combat") == 0) fill = (Color){220,60,60,255};
                else if (strcmp(SKILL_NODES[i].region, "defense") == 0) fill = (Color){60,200,60,255};
                else if (strcmp(SKILL_NODES[i].region, "utility") == 0) fill = (Color){60,120,220,255};
                else if (strcmp(SKILL_NODES[i].region, "major") == 0) fill = (Color){251,191,36,255};
                else fill = WHITE;
                border = WHITE;
            } else if (available) {
                fill = (Color){40,40,60,255};
                border = (Color){200,200,255,255};
            } else {
                fill = (Color){30,30,40,255};
                border = (Color){60,60,70,255};
            }

            DrawCircle((int)nx, (int)ny, r, fill);
            DrawCircleLines((int)nx, (int)ny, r, border);

            // Hover: show name
            Vector2 mouse = GetMousePosition();
            float dx = mouse.x - nx, dy2 = mouse.y - ny;
            if (dx*dx + dy2*dy2 < r*r) {
                DrawText(SKILL_NODES[i].name, (int)nx + (int)r + 4, (int)ny - 6, 10, WHITE);
                // Click to activate
                if (available && me->perkPoints >= SKILL_NODES[i].cost &&
                    IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                    char *msg = msg_activate_node(SKILL_NODES[i].id);
                    net_send(net, msg);
                    free(msg);
                }
            }
        }

        // Reset button
        Rectangle resetBtn = { tx + treeW - 80, ty + treeH - 30, 70, 22 };
        DrawRectangleRec(resetBtn, (Color){80,30,30,255});
        DrawText("Reset", (int)resetBtn.x + 12, (int)resetBtn.y + 4, 12, WHITE);
        if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT) && CheckCollisionPointRec(GetMousePosition(), resetBtn)) {
            char *msg = msg_reset_tree();
            net_send(net, msg);
            free(msg);
        }
    }

    // Connection status
    if (net->state != NET_CONNECTED) {
        const char *status = net->state == NET_CONNECTING ? "Connecting..." : "Disconnected";
        DrawText(status, (int)(screenW/2 - MeasureText(status,16)/2), 50, 16, RED);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/ui.c client/src/ui.h
git commit -m "feat: add UI with HUD, inventory, spell bar, attributes, skill tree"
```

### Task 10: main.c — entry point, name screen, game loop

**Files:**
- Create: `client/src/main.c`

- [ ] **Step 1: Create main.c**

```c
// client/src/main.c
#include <raylib.h>
#include <string.h>
#include <stdio.h>

#include "game.h"
#include "network.h"
#include "input.h"
#include "render.h"
#include "ui.h"

#define SCREEN_W 1024
#define SCREEN_H 768

typedef enum { SCREEN_NAME, SCREEN_GAME } Screen;

int main(int argc, char **argv) {
    const char *host = "localhost";
    int port = 2567;

    // Parse optional args: ./shadowtide [host] [port]
    if (argc > 1) host = argv[1];
    if (argc > 2) port = atoi(argv[2]);

    InitWindow(SCREEN_W, SCREEN_H, "Shadowtide: Endless Horde");
    SetTargetFPS(60);

    // State
    Screen screen = SCREEN_NAME;
    char playerName[NAME_LEN] = "";
    int nameLen = 0;

    GameState gs;
    game_init(&gs);

    NetworkContext net;
    InputState input;
    input_init(&input);

    Camera2DState cam = {0};

    while (!WindowShouldClose()) {
        float dt = GetFrameTime();

        if (screen == SCREEN_NAME) {
            // Name entry
            int key = GetCharPressed();
            while (key > 0) {
                if (key >= 32 && key < 127 && nameLen < NAME_LEN - 1) {
                    playerName[nameLen++] = (char)key;
                    playerName[nameLen] = '\0';
                }
                key = GetCharPressed();
            }
            if (IsKeyPressed(KEY_BACKSPACE) && nameLen > 0) {
                playerName[--nameLen] = '\0';
            }
            if (IsKeyPressed(KEY_ENTER) && nameLen > 0) {
                net_init(&net, host, port, playerName);
                net_start(&net);
                screen = SCREEN_GAME;
            }

            BeginDrawing();
            ClearBackground((Color){20,20,35,255});
            const char *title = "SHADOWTIDE";
            DrawText(title, SCREEN_W/2 - MeasureText(title,40)/2, SCREEN_H/3 - 40, 40, (Color){192,132,252,255});
            const char *sub = "Endless Horde";
            DrawText(sub, SCREEN_W/2 - MeasureText(sub,20)/2, SCREEN_H/3 + 10, 20, GRAY);

            DrawText("Enter your name:", SCREEN_W/2 - 100, SCREEN_H/2 - 10, 16, WHITE);
            DrawRectangle(SCREEN_W/2 - 100, SCREEN_H/2 + 14, 200, 30, (Color){40,40,60,255});
            DrawRectangleLines(SCREEN_W/2 - 100, SCREEN_H/2 + 14, 200, 30, GRAY);
            DrawText(playerName, SCREEN_W/2 - 94, SCREEN_H/2 + 20, 16, WHITE);

            if (nameLen > 0) {
                DrawText("Press ENTER to play", SCREEN_W/2 - MeasureText("Press ENTER to play",14)/2, SCREEN_H/2 + 60, 14, GREEN);
            }
            EndDrawing();
        }
        else if (screen == SCREEN_GAME) {
            // Process incoming messages
            char msgBuf[MSG_MAX_LEN];
            while (mq_dequeue(&net.inbox, msgBuf, MSG_MAX_LEN)) {
                game_process_message(&gs, msgBuf);
            }

            // Input
            input_update(&input, &gs, &net, SCREEN_W, SCREEN_H);

            // Game update
            game_update(&gs, dt);

            // Camera
            render_update_camera(&cam, &gs, SCREEN_W, SCREEN_H);

            // Render
            BeginDrawing();
            ClearBackground(BLACK);
            render_world(&cam, &gs);
            ui_draw(&gs, &input, &net, SCREEN_W, SCREEN_H);
            EndDrawing();
        }
    }

    if (screen == SCREEN_GAME) {
        net_stop(&net);
    }

    CloseWindow();
    return 0;
}
```

- [ ] **Step 2: Build and verify it compiles**

```bash
cd client && make
```

Expected: compiles successfully, produces `shadowtide` binary.

- [ ] **Step 3: Commit**

```bash
git add client/src/main.c
git commit -m "feat: add main entry point with name screen and game loop"
```

### Task 11: Integration test — full client + server

- [ ] **Step 1: Start server in background**

```bash
cd /home/caua/Documentos/Projetos-Pessoais/Shadowtide && npm run dev &
```

- [ ] **Step 2: Run client**

```bash
cd client && ./shadowtide localhost 2567
```

- [ ] **Step 3: Verify**

1. Name screen appears, type a name, press Enter
2. Client connects, player circle appears in the world
3. WASD moves the player
4. Enemies spawn and move
5. Space attacks
6. HUD shows HP, mana, level, wave
7. P opens attribute panel
8. T opens skill tree

- [ ] **Step 4: Fix any issues found during testing**

- [ ] **Step 5: Final commit**

```bash
git add -A client/
git commit -m "fix: integration fixes for Raylib client"
```
