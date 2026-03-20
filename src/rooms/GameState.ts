import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class WaveState extends Schema {
  @type("number") waveNumber = 0;
  @type("string") state: string = "waiting"; // "waiting" | "combat" | "pause"
  @type("number") timer = 0;
  @type("number") enemiesRemaining = 0;
}

export class DroppedItem extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") weaponType = "sword";
  @type("number") weaponRarity = 0; // 0=Common,1=Uncommon,2=Rare,3=Epic,4=Legendary
  @type("number") ttl = 30;
}

export class InventorySlot extends Schema {
  @type("string") weaponType = "";
  @type("number") weaponRarity = -1; // -1 = empty slot
}

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

  // Points
  @type("number") unspentPoints = 0;
  @type("number") perkPoints = 0;

  // Weapon
  @type("string") equippedWeaponType = "sword";
  @type("number") equippedWeaponRarity = 0;

  // Inventory (5 slots)
  @type([InventorySlot]) inventory = new ArraySchema<InventorySlot>();
  // Aim direction (mouse)
  @type("number") aimX = 0;
  @type("number") aimY = 1;

  // Skill tree
  @type(["string"]) activeSkillNodes = new ArraySchema<string>();

  // Derived stats
  @type("number") moveSpeed = 180;
  @type("number") critChance = 0;
  @type("number") hpRegen = 0;
}

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

export class FloatingText extends Schema {
  @type("string") id = "";
  @type("string") text = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") ttl = 1;
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type({ map: FloatingText }) floatingTexts = new MapSchema<FloatingText>();
  @type({ map: DroppedItem }) droppedItems = new MapSchema<DroppedItem>();
  @type(WaveState) wave = new WaveState();
  @type("number") worldWidth = 1600;
  @type("number") worldHeight = 1200;
}
