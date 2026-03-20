export interface SkillNode {
  id: string;
  name: string;
  region: "combat" | "defense" | "utility" | "center" | "major";
  cost: number;
  connections: string[];
  effects: SkillEffect[];
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
  | "critDamageFlat"
  | "doubleStrikeChance"
  | "vampirismPercent"
  | "maxHpPercent"
  | "hpRegenFlat"
  | "killShieldHp"
  | "damageReductionPercent"
  | "secondChance"
  | "moveSpeedPercent"
  | "pickupRadiusPercent"
  | "dropChancePercent"
  | "dropRarityShift"
  | "xpBonusPercent"
  | "allyDamageAuraPercent"
  | "berserkerDamagePercent"
  ;

const CENTER: SkillNode = {
  id: "center", name: "Origin", region: "center", cost: 0,
  connections: ["c1", "d1", "u1"],
  effects: [],
  px: 0.5, py: 0.5,
};

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

const MAJOR_NODES: SkillNode[] = [
  { id: "mc1", name: "Berserker", region: "major", cost: 2, connections: ["c3", "d3"], effects: [{ type: "berserkerDamagePercent", value: 30 }], px: 0.45, py: 0.5 },
  { id: "mc2", name: "Scavenger", region: "major", cost: 2, connections: ["d9", "u3"], effects: [{ type: "dropChancePercent", value: 10 }, { type: "dropRarityShift", value: 1 }], px: 0.6, py: 0.72 },
];

export const ALL_NODES: SkillNode[] = [CENTER, ...COMBAT_NODES, ...DEFENSE_NODES, ...UTILITY_NODES, ...MAJOR_NODES];
export const NODE_MAP = new Map<string, SkillNode>(ALL_NODES.map(n => [n.id, n]));

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
