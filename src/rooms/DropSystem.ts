import { DroppedItem, DroppedSpell, GameState } from "./GameState.js";
import { rollWeaponType, rollRarity } from "./WeaponSystem.js";
import { type SpellId, rollSpellDrop } from "./SpellSystem.js";
import { type SkillBuffs, emptyBuffs } from "./SkillTree.js";
import { distance } from "./utils.js";

const DROP_TTL = 30;
const MAX_DROPS = 40;
const DROP_CHANCE_NORMAL = 0.05;
const PICKUP_RANGE = 40;

export class DropSystem {
  dropSeq = 1;
  private droppedSpellSeq = 1;

  constructor(
    private state: GameState,
    private playerBuffs: Map<string, SkillBuffs>,
  ) {}

  handlePickupItem(sessionId: string, payload: any) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const itemId = payload?.itemId;
    if (!itemId) return;

    const item = this.state.droppedItems.get(itemId);
    if (!item) return;

    const buffs = this.playerBuffs.get(sessionId) ?? emptyBuffs();
    const pickupRange = PICKUP_RANGE * (1 + buffs.pickupRadiusPercent / 100);
    if (distance(player, item) > pickupRange) return;

    let placed = false;
    for (let i = 0; i < 5; i++) {
      if (player.inventory[i] && player.inventory[i].weaponRarity < 0) {
        player.inventory[i].weaponType = item.weaponType;
        player.inventory[i].weaponRarity = item.weaponRarity;
        placed = true;
        break;
      }
    }

    if (!placed) {
      const oldType = player.equippedWeaponType;
      const oldRarity = player.equippedWeaponRarity;
      player.equippedWeaponType = item.weaponType;
      player.equippedWeaponRarity = item.weaponRarity;
      if (oldType !== "sword" || oldRarity !== 0) {
        const drop = new DroppedItem();
        drop.id = `d${this.dropSeq++}`;
        drop.x = player.x;
        drop.y = player.y;
        drop.weaponType = oldType;
        drop.weaponRarity = oldRarity;
        drop.ttl = 30;
        this.state.droppedItems.set(drop.id, drop);
      }
    }

    this.state.droppedItems.delete(itemId);
  }

  handlePickupSpell(sessionId: string, payload: any) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const itemId = payload?.itemId;
    if (!itemId) return;
    const item = this.state.droppedSpells.get(itemId);
    if (!item) return;
    if (distance(player, item) > PICKUP_RANGE) return;

    for (let i = 0; i < 5; i++) {
      const slot = player.spellSlots[i];
      if (slot && (!slot.spellId || slot.spellRarity < 0)) {
        slot.spellId = item.spellId;
        slot.spellRarity = item.spellRarity;
        slot.cooldownLeft = 0;
        this.state.droppedSpells.delete(itemId);
        return;
      }
    }
    const slot = player.spellSlots[0];
    if (slot) {
      this.spawnDroppedSpell(player.x, player.y, slot.spellId as SpellId, slot.spellRarity);
      slot.spellId = item.spellId;
      slot.spellRarity = item.spellRarity;
      slot.cooldownLeft = 0;
    }
    this.state.droppedSpells.delete(itemId);
  }

  spawnDrop(x: number, y: number, isBoss: boolean, killerId: string) {
    const waveNum = this.state.wave.waveNumber;
    const killer = this.state.players.get(killerId);
    const killerLck = killer?.lck ?? 0;
    const buffs = this.playerBuffs.get(killerId) ?? emptyBuffs();
    const dropChance = isBoss ? 1.0 : (DROP_CHANCE_NORMAL + buffs.dropChancePercent / 100);
    if (Math.random() > dropChance) return;

    if (this.state.droppedItems.size >= MAX_DROPS) {
      const firstKey = this.state.droppedItems.keys().next().value;
      if (firstKey) this.state.droppedItems.delete(firstKey);
    }

    const item = new DroppedItem();
    item.id = `d${this.dropSeq++}`;
    item.x = x;
    item.y = y;
    item.weaponType = rollWeaponType();
    let rarity = rollRarity(isBoss, waveNum, killerLck);
    rarity = Math.min(4, rarity + buffs.dropRarityShift);
    item.weaponRarity = rarity;
    item.ttl = DROP_TTL;
    this.state.droppedItems.set(item.id, item);
  }

  spawnSpellDrop(x: number, y: number) {
    const { spellId, rarity } = rollSpellDrop();
    const item = new DroppedSpell();
    item.id = `ds${this.droppedSpellSeq++}`;
    item.x = x;
    item.y = y;
    item.spellId = spellId;
    item.spellRarity = rarity;
    item.ttl = 30;
    this.state.droppedSpells.set(item.id, item);
  }

  spawnDroppedSpell(x: number, y: number, spellId: SpellId, rarity: number) {
    const item = new DroppedSpell();
    item.id = `ds${this.droppedSpellSeq++}`;
    item.x = x;
    item.y = y;
    item.spellId = spellId;
    item.spellRarity = rarity;
    item.ttl = 30;
    this.state.droppedSpells.set(item.id, item);
  }

  updateDrops(dt: number) {
    for (const [id, item] of this.state.droppedItems) {
      item.ttl -= dt;
      if (item.ttl <= 0) {
        this.state.droppedItems.delete(id);
      }
    }
    for (const [id, item] of this.state.droppedSpells) {
      item.ttl -= dt;
      if (item.ttl <= 0) this.state.droppedSpells.delete(id);
    }
  }
}
