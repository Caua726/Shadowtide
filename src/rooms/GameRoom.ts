import { Room, type Client } from "colyseus";
import { DroppedItem, GameState } from "./GameState.js";
import { type SkillBuffs } from "./SkillTree.js";
import { WaveManager } from "./WaveManager.js";
import { CombatSystem } from "./CombatSystem.js";
import { SpellCaster } from "./SpellCaster.js";
import { PlayerManager } from "./PlayerManager.js";
import { DropSystem } from "./DropSystem.js";
import { saveState, loadState } from "./SaveSystem.js";
import { RawSocketBridge } from "./RawSocketBridge.js";
import { bridge } from "../server.js";

const TICK_RATE = 30;
const SAVE_INTERVAL_MS = 30000;

export class GameRoom extends Room<{ state: GameState }> {
  state = new GameState();
  maxClients = 32;

  private playerBuffs = new Map<string, SkillBuffs>();
  private secondChanceUsed = new Map<string, boolean>();

  private waveManager!: WaveManager;
  public combatSystem!: CombatSystem;
  public spellCaster!: SpellCaster;
  public playerManager!: PlayerManager;
  public dropSystem!: DropSystem;

  private saveInterval?: NodeJS.Timeout;
  bridge?: RawSocketBridge;

  onCreate() {
    this.dropSystem = new DropSystem(this.state, this.playerBuffs);

    this.waveManager = new WaveManager(
      this.state,
      (type, data) => this.broadcastAll(type, data),
      this.secondChanceUsed,
    );

    this.playerManager = new PlayerManager(
      this.state,
      this.playerBuffs,
      this.secondChanceUsed,
      () => this.waveManager.startWavePause(),
    );

    this.spellCaster = new SpellCaster(
      this.state,
      (type, data) => this.broadcastAll(type, data),
      this.playerBuffs,
      () => this.combatSystem,
    );

    this.combatSystem = new CombatSystem(
      this.state,
      (type, data) => this.broadcastAll(type, data),
      this.playerBuffs,
      this.playerManager.aimByClient,
      this.secondChanceUsed,
      () => this.spellCaster.activeSpellEffects,
      () => this.dropSystem,
    );

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);
    this.registerMessages();

    const loaded = loadState(this.state);
    if (loaded) {
      this.waveManager.enemySeq = loaded.enemySeq;
      this.dropSystem.dropSeq = loaded.dropSeq;
    }

    this.saveInterval = setInterval(() => this.doSave(), SAVE_INTERVAL_MS);

    if (bridge) {
      this.bridge = bridge;
      this.bridge.bind(
        this.state,
        this.playerBuffs,
        (sessionId, name) => this.playerManager.createPlayer(sessionId, name, this.state.players.size + 1),
        (sessionId) => { this.playerManager.removePlayer(sessionId); this.combatSystem.cleanupClient(sessionId); },
        (sessionId, type, payload) => this.handleBridgeMessage(sessionId, type, payload),
      );
    }
  }

  private broadcastAll(type: string, data: any) {
    this.broadcast(type, data);
    this.bridge?.broadcastEvent(type, data);
  }

  private registerMessages() {
    this.onMessage("move", (client, payload: { x?: number; y?: number } | undefined) => {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 0;
      const len = Math.hypot(x, y);
      if (len > 0) {
        this.playerManager.inputByClient.set(client.sessionId, { x: x / len, y: y / len });
      } else {
        this.playerManager.inputByClient.set(client.sessionId, { x: 0, y: 0 });
      }
    });

    this.onMessage("aim", (client, payload: { x?: number; y?: number } | undefined) => {
      const x = Number(payload?.x) || 0;
      const y = Number(payload?.y) || 1;
      const len = Math.hypot(x, y) || 1;
      this.playerManager.aimByClient.set(client.sessionId, { x: x / len, y: y / len });
      const player = this.state.players.get(client.sessionId);
      if (player) { player.aimX = x / len; player.aimY = y / len; }
    });

    this.onMessage("attack", (client) => this.combatSystem.handleAttack(client.sessionId));
    this.onMessage("allocate_points", (client, payload) => this.playerManager.handleAllocatePoints(client.sessionId, payload));
    this.onMessage("activate_node", (client, payload) => this.playerManager.handleActivateNode(client.sessionId, payload));
    this.onMessage("reset_tree", (client) => this.playerManager.handleResetTree(client.sessionId));
    this.onMessage("pickup_item", (client, payload) => this.dropSystem.handlePickupItem(client.sessionId, payload));
    this.onMessage("pickup_spell", (client, payload) => this.dropSystem.handlePickupSpell(client.sessionId, payload));

    this.onMessage("cast_spell", (client, payload: { slot?: number; targetX?: number; targetY?: number } | undefined) => {
      this.spellCaster.handleCastSpell(client.sessionId, Number(payload?.slot) || 0, Number(payload?.targetX) || 0, Number(payload?.targetY) || 0);
    });

    this.onMessage("swap_weapon", (client, payload: { slot?: number } | undefined) => {
      const player = this.state.players.get(client.sessionId);
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
    });

    this.onMessage("drop_weapon", (client) => {
      const player = this.state.players.get(client.sessionId);
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
    });

    this.onMessage("reset_game", () => {
      // Reset wave state
      this.state.wave.waveNumber = 0;
      this.state.wave.state = "waiting";
      this.state.wave.timer = 0;
      this.state.wave.enemiesRemaining = 0;
      // Clear all enemies and drops
      this.state.enemies.clear();
      this.state.droppedItems.clear();
      this.state.droppedSpells.clear();
      this.state.floatingTexts.clear();
      // Start fresh
      if (this.state.players.size > 0) {
        this.waveManager.startWavePause();
      }
      this.broadcastAll("wave_complete", { waveNumber: 0, nextWaveIn: 10 });
    });

    // Debug commands
    this.onMessage("debug", (client, payload: any) => {
      const player = this.state.players.get(client.sessionId);
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
          this.broadcastAll("level_up", { id: client.sessionId, level: player.level });
          break;
        }
        case "give_weapon": {
          const wType = payload?.weaponType || "sword";
          const wRarity = Math.min(Math.max(Number(payload?.rarity) || 0, 0), 4);
          player.equippedWeaponType = wType;
          player.equippedWeaponRarity = wRarity;
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
    });
  }

  handleBridgeMessage(sessionId: string, type: string, payload: any) {
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
        if (this.state.players.size > 0) {
          this.waveManager.startWavePause();
        }
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
            const wType = payload?.weaponType || "sword";
            const wRarity = Math.min(Math.max(Number(payload?.rarity) || 0, 0), 4);
            player.equippedWeaponType = wType;
            player.equippedWeaponRarity = wRarity;
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

  onJoin(client: Client, options: { name?: string }) {
    this.playerManager.createPlayer(client.sessionId, String(options?.name || ""), this.clients.length);
  }

  onLeave(client: Client) {
    this.playerManager.removePlayer(client.sessionId);
    this.combatSystem.cleanupClient(client.sessionId);
  }

  onDispose() {
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.doSave();
    this.bridge?.shutdown();
  }

  private update(deltaTime: number) {
    const dt = deltaTime / 1000;
    const now = Date.now();

    this.waveManager.updateWave(dt);
    this.playerManager.updatePlayers(dt);
    this.combatSystem.updateEnemies(dt, now);
    this.combatSystem.updateProjectiles(dt);
    this.dropSystem.updateDrops(dt);
    this.updateFloatingTexts(dt);
    this.playerManager.updateHpRegen(dt);
    this.spellCaster.updateSpellEffects(dt);
    this.spellCaster.updateMana(dt);
    this.spellCaster.updateSpellCooldowns(dt);
    this.bridge?.sendPatches();
  }

  private updateFloatingTexts(dt: number) {
    for (const [id, text] of this.state.floatingTexts) {
      text.y -= 18 * dt;
      text.ttl -= dt;
      if (text.ttl <= 0) this.state.floatingTexts.delete(id);
    }
  }

  private doSave() {
    saveState(this.state, this.waveManager.enemySeq, this.dropSystem.dropSeq);
  }
}
