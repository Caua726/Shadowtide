import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DroppedItem, DroppedSpell, Enemy, GameState } from "./GameState.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAVE_PATH = path.join(__dirname, "../../data/state.json");

export function saveState(
  state: GameState,
  enemySeq: number,
  dropSeq: number,
) {
  try {
    const data = {
      waveNumber: state.wave.waveNumber,
      waveState: state.wave.state,
      enemies: [...state.enemies.values()].map(e => ({
        id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp,
        speed: e.speed, xpReward: e.xpReward, enemyType: e.enemyType,
        isBoss: e.isBoss, damage: e.damage,
      })),
      drops: [...state.droppedItems.values()].map(d => ({
        id: d.id, x: d.x, y: d.y, weaponType: d.weaponType,
        weaponRarity: d.weaponRarity, ttl: d.ttl,
      })),
      spellDrops: [...state.droppedSpells.values()].map(d => ({
        id: d.id, x: d.x, y: d.y, spellId: d.spellId, spellRarity: d.spellRarity, ttl: d.ttl,
      })),
      enemySeq,
      dropSeq,
    };
    const dir = path.dirname(SAVE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SAVE_PATH, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save state:", err);
  }
}

export function loadState(
  state: GameState,
): { enemySeq: number; dropSeq: number } | null {
  try {
    if (!fs.existsSync(SAVE_PATH)) return null;
    const raw = fs.readFileSync(SAVE_PATH, "utf-8");
    const data = JSON.parse(raw);

    state.wave.waveNumber = data.waveNumber ?? 0;
    state.wave.state = data.waveState ?? "waiting";

    if (data.enemies) {
      for (const e of data.enemies) {
        const enemy = new Enemy();
        Object.assign(enemy, e);
        state.enemies.set(enemy.id, enemy);
      }
    }

    if (data.drops) {
      for (const d of data.drops) {
        const item = new DroppedItem();
        Object.assign(item, d);
        state.droppedItems.set(item.id, item);
      }
    }

    if (data.spellDrops) {
      for (const d of data.spellDrops) {
        const item = new DroppedSpell();
        Object.assign(item, d);
        state.droppedSpells.set(item.id, item);
      }
    }

    console.log(`Loaded state: wave ${data.waveNumber}, ${data.enemies?.length ?? 0} enemies, ${data.drops?.length ?? 0} drops`);
    return { enemySeq: data.enemySeq ?? 1, dropSeq: data.dropSeq ?? 1 };
  } catch (err) {
    console.error("Failed to load state:", err);
    return null;
  }
}
