import { WebSocketServer, WebSocket } from "ws";
import type { Server as HTTPServer } from "node:http";
import { GameState, Player, Enemy, DroppedItem, DroppedSpell, FloatingText, InventorySlot, SpellSlot } from "./GameState.js";
import type { SkillBuffs } from "./SkillTree.js";

interface BridgeClient {
  ws: WebSocket;
  sessionId: string;
  name: string;
  lastSnapshot: string;
}

interface BridgeCallbacks {
  state: GameState;
  playerBuffs: Map<string, SkillBuffs>;
  onPlayerJoin: (sessionId: string, name: string) => void;
  onPlayerLeave: (sessionId: string) => void;
  onMessage: (sessionId: string, type: string, payload: any) => void;
}

export class RawSocketBridge {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, BridgeClient>();
  private clientSeq = 0;
  private callbacks: BridgeCallbacks | null = null;

  /**
   * Attach the WebSocket server to the HTTP server.
   * This must be called early (before Colyseus clients connect)
   * to intercept upgrade requests on /ws/raw.
   */
  attach(server: HTTPServer) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));

    // Intercept upgrade events before Colyseus gets them.
    const existingListeners = server.listeners("upgrade") as ((...args: any[]) => void)[];
    server.removeAllListeners("upgrade");

    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
      if (pathname === "/ws/raw") {
        this.wss!.handleUpgrade(req, socket as any, head, (ws) => {
          this.wss!.emit("connection", ws, req);
        });
      } else {
        // Delegate to Colyseus and other listeners
        for (const listener of existingListeners) {
          listener.call(server, req, socket, head);
        }
      }
    });

    console.log("RawSocketBridge listening on /ws/raw");
  }

  /**
   * Bind the game callbacks. Called from GameRoom.onCreate() once
   * the game state and subsystems are ready.
   */
  bind(
    state: GameState,
    playerBuffs: Map<string, SkillBuffs>,
    onPlayerJoin: (sessionId: string, name: string) => void,
    onPlayerLeave: (sessionId: string) => void,
    onMessage: (sessionId: string, type: string, payload: any) => void,
  ) {
    this.callbacks = { state, playerBuffs, onPlayerJoin, onPlayerLeave, onMessage };
  }

  private handleConnection(ws: WebSocket, req: any) {
    if (!this.callbacks) {
      // Room not created yet, reject connection
      ws.close(4000, "Game room not ready");
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const name = url.searchParams.get("name") || "";
    const sessionId = `raw_${++this.clientSeq}_${Date.now()}`;
    const client: BridgeClient = { ws, sessionId, name, lastSnapshot: "" };
    this.clients.set(ws, client);
    this.callbacks.onPlayerJoin(sessionId, name);
    this.send(ws, { type: "identity", sessionId });
    const sync = this.buildStateSync();
    this.send(ws, sync);
    client.lastSnapshot = JSON.stringify(sync);
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type) this.callbacks?.onMessage(sessionId, msg.type, msg);
      } catch {}
    });
    ws.on("close", () => { this.callbacks?.onPlayerLeave(sessionId); this.clients.delete(ws); });
    ws.on("error", () => { this.callbacks?.onPlayerLeave(sessionId); this.clients.delete(ws); });
  }

  private send(ws: WebSocket, msg: any) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  sendPatches() {
    if (!this.callbacks) return;
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

  broadcastEvent(event: string, data: any) {
    const msg = JSON.stringify({ type: "event", event, data });
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
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
    const state = this.callbacks!.state;
    const players: any = {};
    state.players.forEach((p, id) => { players[id] = this.serializePlayer(p); });
    const enemies: any = {};
    state.enemies.forEach((e, id) => {
      enemies[id] = { id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, speed: e.speed, damage: e.damage, enemyType: e.enemyType, isBoss: e.isBoss };
    });
    const droppedItems: any = {};
    state.droppedItems.forEach((d, id) => {
      droppedItems[id] = { id: d.id, x: d.x, y: d.y, weaponType: d.weaponType, weaponRarity: d.weaponRarity, ttl: d.ttl };
    });
    const droppedSpells: any = {};
    state.droppedSpells.forEach((s, id) => {
      droppedSpells[id] = { id: s.id, x: s.x, y: s.y, spellId: s.spellId, spellRarity: s.spellRarity, ttl: s.ttl };
    });
    const floatingTexts: any = {};
    state.floatingTexts.forEach((t, id) => {
      floatingTexts[id] = { id: t.id, text: t.text, x: t.x, y: t.y, ttl: t.ttl };
    });
    return {
      type: "state_sync",
      players, enemies, droppedItems, droppedSpells, floatingTexts,
      wave: {
        waveNumber: state.wave.waveNumber, state: state.wave.state,
        timer: state.wave.timer, enemiesRemaining: state.wave.enemiesRemaining,
      },
    };
  }

  private buildPatch(prev: any, curr: any): any | null {
    const patch: any = { type: "state_patch" };
    let hasChanges = false;
    for (const key of ["players", "enemies", "droppedItems", "droppedSpells", "floatingTexts"] as const) {
      const prevMap = prev[key] || {};
      const currMap = curr[key] || {};
      const diff: any = {};
      let collectionChanged = false;
      for (const id of Object.keys(currMap)) {
        if (!prevMap[id] || JSON.stringify(prevMap[id]) !== JSON.stringify(currMap[id])) {
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
            diff[id] = currMap[id];
            collectionChanged = true;
          }
        }
      }
      for (const id of Object.keys(prevMap)) {
        if (!currMap[id]) { diff[id] = null; collectionChanged = true; }
      }
      if (collectionChanged) { patch[key] = diff; hasChanges = true; }
    }
    if (JSON.stringify(prev.wave) !== JSON.stringify(curr.wave)) {
      const waveDiff: any = {};
      for (const field of Object.keys(curr.wave)) {
        if (prev.wave[field] !== curr.wave[field]) waveDiff[field] = curr.wave[field];
      }
      patch.wave = waveDiff;
      hasChanges = true;
    }
    return hasChanges ? patch : null;
  }

  shutdown() {
    for (const [ws, client] of this.clients) { this.callbacks?.onPlayerLeave(client.sessionId); ws.close(); }
    this.clients.clear();
    this.wss?.close();
  }
}
