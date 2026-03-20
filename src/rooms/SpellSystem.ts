export type SpellId = "fireball" | "iceRay" | "magicShield" | "heal" | "meteor" | "chainLightning" | "teleport" | "summonSpirits" | "arcaneStorm" | "blackHole";

export interface SpellDef {
  id: SpellId;
  name: string;
  description: string;
  baseCooldownMs: number;
  baseManaCost: number;
  baseDamage: number;         // 0 for utility spells
  duration: number;           // seconds, 0 for instant
  radius: number;             // AoE radius, 0 for single target
  projectileSpeed: number;    // 0 for instant/placed spells
  spellType: "projectile" | "aoe_placed" | "aoe_self" | "buff_self" | "teleport" | "summon" | "channel";
}

export const SPELL_DEFS: Record<SpellId, SpellDef> = {
  fireball: {
    id: "fireball", name: "Bola de Fogo", description: "Projetil explosivo que causa dano em area.",
    baseCooldownMs: 1500, baseManaCost: 8, baseDamage: 30,
    duration: 0, radius: 70, projectileSpeed: 450,
    spellType: "projectile",
  },
  iceRay: {
    id: "iceRay", name: "Raio de Gelo", description: "Projetil que desacelera inimigos atingidos por 3s.",
    baseCooldownMs: 2000, baseManaCost: 10, baseDamage: 15,
    duration: 3, radius: 0, projectileSpeed: 500,
    spellType: "projectile",
  },
  magicShield: {
    id: "magicShield", name: "Escudo Magico", description: "Barreira que absorve dano por 5s.",
    baseCooldownMs: 12000, baseManaCost: 20, baseDamage: 0,
    duration: 5, radius: 0, projectileSpeed: 0,
    spellType: "buff_self",
  },
  heal: {
    id: "heal", name: "Cura", description: "Restaura HP ao longo de 4s.",
    baseCooldownMs: 8000, baseManaCost: 15, baseDamage: 0, // heal amount = baseDamage field repurposed: 40 HP
    duration: 4, radius: 0, projectileSpeed: 0,
    spellType: "buff_self",
  },
  meteor: {
    id: "meteor", name: "Meteoro", description: "Chama um meteoro devastador na posicao do mouse.",
    baseCooldownMs: 10000, baseManaCost: 25, baseDamage: 80,
    duration: 0, radius: 120, projectileSpeed: 0,
    spellType: "aoe_placed",
  },
  chainLightning: {
    id: "chainLightning", name: "Corrente de Raios", description: "Raio que pula entre 5 inimigos proximos.",
    baseCooldownMs: 5000, baseManaCost: 18, baseDamage: 25,
    duration: 0, radius: 150, projectileSpeed: 0, // chain radius
    spellType: "channel",
  },
  teleport: {
    id: "teleport", name: "Teleporte", description: "Move instantaneamente para a posicao do mouse.",
    baseCooldownMs: 6000, baseManaCost: 12, baseDamage: 0,
    duration: 0, radius: 0, projectileSpeed: 0,
    spellType: "teleport",
  },
  summonSpirits: {
    id: "summonSpirits", name: "Invocar Espiritos", description: "Invoca 3 espiritos que atacam inimigos por 8s.",
    baseCooldownMs: 20000, baseManaCost: 30, baseDamage: 12,
    duration: 8, radius: 200, projectileSpeed: 0,
    spellType: "summon",
  },
  arcaneStorm: {
    id: "arcaneStorm", name: "Tempestade Arcana", description: "Cria uma tempestade de energia que causa dano continuo por 6s.",
    baseCooldownMs: 15000, baseManaCost: 35, baseDamage: 15, // per tick
    duration: 6, radius: 140, projectileSpeed: 0,
    spellType: "aoe_placed",
  },
  blackHole: {
    id: "blackHole", name: "Buraco Negro", description: "Cria um buraco negro que puxa e destroi tudo ao redor por 5s.",
    baseCooldownMs: 30000, baseManaCost: 50, baseDamage: 20, // per tick
    duration: 5, radius: 200, projectileSpeed: 0,
    spellType: "aoe_placed",
  },
};

export const ALL_SPELL_IDS = Object.keys(SPELL_DEFS) as SpellId[];
export const SPELL_RARITY_POWER = [1.0, 1.3, 1.7, 2.2, 3.5];

export function getSpellDamage(spellId: SpellId, rarity: number, intel: number): number {
  const def = SPELL_DEFS[spellId];
  return Math.round(def.baseDamage * SPELL_RARITY_POWER[rarity] * (1 + intel * 0.04));
}

export function getSpellCooldown(spellId: SpellId, intel: number): number {
  const def = SPELL_DEFS[spellId];
  return Math.round(def.baseCooldownMs * (1 / (1 + intel * 0.003)));
}

export function getMaxMana(intel: number): number {
  return 50 + intel * 5;
}

export function getManaRegen(intel: number): number {
  return 2 + intel * 0.15; // mana per second
}

export function rollSpellDrop(): { spellId: SpellId; rarity: number } {
  const spellId = ALL_SPELL_IDS[Math.floor(Math.random() * ALL_SPELL_IDS.length)];
  // Weighted rarity: common 40%, uncommon 30%, rare 18%, epic 9%, legendary 3%
  const roll = Math.random() * 100;
  let rarity: number;
  if (roll < 40) rarity = 0;
  else if (roll < 70) rarity = 1;
  else if (roll < 88) rarity = 2;
  else if (roll < 97) rarity = 3;
  else rarity = 4;
  return { spellId, rarity };
}

// Active spell effects tracked server-side
export interface ActiveSpellEffect {
  id: string;
  spellId: SpellId;
  casterId: string;
  x: number;
  y: number;
  damage: number;
  radius: number;
  remainingTime: number;
  pullForce?: number; // for black hole
  slowFactor?: number; // for ice ray
  healPerTick?: number; // for heal
  shieldHp?: number; // for magic shield
  // Summon spirits
  spirits?: Array<{ x: number; y: number; targetId?: string }>;
}
