// Shared constants for the Shadowtide client

export const RARITY_CSS = ["#fff", "#4ade80", "#60a5fa", "#c084fc", "#fbbf24"];
export const RARITY_LABEL = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
export const RARITY_HEX = [0xffffff, 0x4ade80, 0x60a5fa, 0xc084fc, 0xfbbf24];
export const RARITY_MULT = [1, 1.2, 1.5, 2, 3];

export const WEAPON_ICONS = { sword: "\u2694", hammer: "\uD83D\uDD28", bow: "\uD83C\uDFF9", staff: "\uD83E\uDDF9", pistol: "\uD83D\uDD2B", shotgun: "\uD83D\uDCA5", arcaneOrb: "\uD83D\uDD2E" };
export const WEAPON_NAMES = { sword: "Espada", hammer: "Martelo", bow: "Arco", staff: "Cajado", pistol: "Pistola", shotgun: "Escopeta", arcaneOrb: "Orbe Arcano" };
export const WEAPON_DESC = {
  sword: "Melee equilibrado. Escala com STR.",
  hammer: "Melee pesado com knockback. Escala com STR.",
  bow: "Projetil reto, alcance medio. Escala com DEX.",
  staff: "Projetil magico com explosao em area. Escala com INT.",
  pistol: "Tiro rapido, dano baixo. Escala com DEX.",
  shotgun: "Cone de 5 projeteis, devastador de perto. Escala com STR.",
  arcaneOrb: "Projetil perseguidor. Escala com INT."
};
export const WEAPON_SCALE_ATTR = { sword: "STR", hammer: "STR", bow: "DEX", staff: "INT", pistol: "DEX", shotgun: "STR", arcaneOrb: "INT" };
export const WEAPON_BASE_DMG = { sword: 14, hammer: 24, bow: 12, staff: 18, pistol: 7, shotgun: 25, arcaneOrb: 10 };
export const WEAPON_SPRITE_COLORS = {
  sword: 0xcccccc, hammer: 0x888888, bow: 0x8b5e3c,
  staff: 0x9b59b6, pistol: 0x444444, shotgun: 0x333333, arcaneOrb: 0x00ccff
};

export const ENEMY_COLORS = {
  slime: 0x6bff6b, skeleton: 0xd4d4d4, archer: 0x8b5e3c, wolf: 0x888888,
  golem: 0x8b7355, necromancer: 0x9b59b6, creeper: 0xff4444, sorcerer: 0x3498db,
};

export const PROJECTILE_COLORS = {
  bow: 0xc28b2c, staff: 0x9b59b6, pistol: 0xffff00, shotgun: 0xff8800,
  arcaneOrb: 0x00ffcc, archer: 0x8b5e3c, sorcerer: 0x3498db,
};

export const SPELL_NAMES = {
  fireball: "Bola de Fogo", iceRay: "Raio de Gelo", magicShield: "Escudo Magico",
  heal: "Cura", meteor: "Meteoro", chainLightning: "Corrente de Raios",
  teleport: "Teleporte", summonSpirits: "Invocar Espiritos",
  arcaneStorm: "Tempestade Arcana", blackHole: "Buraco Negro"
};
export const SPELL_ICONS = {
  fireball: "\uD83D\uDD25", iceRay: "\u2744\uFE0F", magicShield: "\uD83D\uDEE1\uFE0F",
  heal: "\uD83D\uDC9A", meteor: "\u2604\uFE0F", chainLightning: "\u26A1",
  teleport: "\uD83C\uDF00", summonSpirits: "\uD83D\uDC7B",
  arcaneStorm: "\uD83C\uDF29\uFE0F", blackHole: "\uD83D\uDD73\uFE0F"
};
export const SPELL_COLORS = {
  fireball: 0xff6600, iceRay: 0x66ccff, magicShield: 0x44aaff,
  heal: 0x44ff88, meteor: 0xff4400, chainLightning: 0xffff44,
  teleport: 0xcc66ff, summonSpirits: 0x88ffcc,
  arcaneStorm: 0x9966ff, blackHole: 0x220033
};
export const SPELL_DESC = {
  fireball: "Projetil explosivo com dano em area",
  iceRay: "Projetil que desacelera inimigos por 3s",
  magicShield: "Barreira que absorve dano por 5s",
  heal: "Restaura HP ao longo de 4s",
  meteor: "Meteoro devastador na posicao do mouse",
  chainLightning: "Raio que pula entre 5 inimigos",
  teleport: "Move instantaneamente para o mouse",
  summonSpirits: "Invoca 3 espiritos aliados por 8s",
  arcaneStorm: "Tempestade de energia com dano continuo 6s",
  blackHole: "Puxa e destroi tudo ao redor por 5s"
};

export const SKILL_NODES = [
  { id: "center", name: "Origin", region: "center", cost: 0, conns: ["c1", "d1", "u1"], px: .5, py: .5, effects: "Start" },
  { id: "c1", name: "Sharpness I", region: "combat", cost: 1, conns: ["center", "c2", "c3"], px: .38, py: .42, effects: "+5% melee dmg" },
  { id: "c2", name: "Precision I", region: "combat", cost: 1, conns: ["c1", "c4", "c5"], px: .28, py: .35, effects: "+5% ranged dmg" },
  { id: "c3", name: "Swift Strikes", region: "combat", cost: 1, conns: ["c1", "c6", "mc1"], px: .42, py: .32, effects: "+5% atk speed" },
  { id: "c4", name: "Sharpness II", region: "combat", cost: 1, conns: ["c2", "c7"], px: .2, py: .28, effects: "+8% melee" },
  { id: "c5", name: "Precision II", region: "combat", cost: 1, conns: ["c2", "c7", "c8"], px: .3, py: .22, effects: "+8% ranged" },
  { id: "c6", name: "Ferocity", region: "combat", cost: 1, conns: ["c3", "c8", "c9"], px: .45, py: .2, effects: "+8% atk speed" },
  { id: "c7", name: "Devastation", region: "combat", cost: 1, conns: ["c4", "c5", "c10"], px: .22, py: .15, effects: "+5% all dmg" },
  { id: "c8", name: "Devastating Crit", region: "combat", cost: 1, conns: ["c5", "c6", "c10"], px: .35, py: .12, effects: "+50% crit dmg" },
  { id: "c9", name: "Double Strike", region: "combat", cost: 1, conns: ["c6", "c11"], px: .5, py: .1, effects: "15% double atk" },
  { id: "c10", name: "Sharpness III", region: "combat", cost: 1, conns: ["c7", "c8", "c11"], px: .28, py: .05, effects: "+10% melee" },
  { id: "c11", name: "Vampirism", region: "combat", cost: 1, conns: ["c9", "c10"], px: .42, py: .03, effects: "5% lifesteal" },
  { id: "d1", name: "Toughness I", region: "defense", cost: 1, conns: ["center", "d2", "d3"], px: .38, py: .58, effects: "+5% max HP" },
  { id: "d2", name: "Regen I", region: "defense", cost: 1, conns: ["d1", "d4", "d5"], px: .28, py: .65, effects: "+0.5 HP/s" },
  { id: "d3", name: "Thick Skin", region: "defense", cost: 1, conns: ["d1", "d6", "mc1"], px: .42, py: .68, effects: "3% dmg reduct" },
  { id: "d4", name: "Toughness II", region: "defense", cost: 1, conns: ["d2", "d7"], px: .2, py: .72, effects: "+8% max HP" },
  { id: "d5", name: "Regen II", region: "defense", cost: 1, conns: ["d2", "d7", "d8"], px: .3, py: .78, effects: "+1.0 HP/s" },
  { id: "d6", name: "Iron Will", region: "defense", cost: 1, conns: ["d3", "d8", "d9"], px: .45, py: .8, effects: "5% dmg reduct" },
  { id: "d7", name: "Toughness III", region: "defense", cost: 1, conns: ["d4", "d5", "d10"], px: .22, py: .85, effects: "+10% HP" },
  { id: "d8", name: "Kill Shield", region: "defense", cost: 1, conns: ["d5", "d6", "d10"], px: .35, py: .88, effects: "+10 HP/kill" },
  { id: "d9", name: "Fortitude", region: "defense", cost: 1, conns: ["d6", "d11", "mc2"], px: .52, py: .88, effects: "8% dmg reduct" },
  { id: "d10", name: "Regen III", region: "defense", cost: 1, conns: ["d7", "d8", "d11"], px: .28, py: .95, effects: "+1.5 HP/s" },
  { id: "d11", name: "Second Chance", region: "defense", cost: 1, conns: ["d9", "d10"], px: .42, py: .97, effects: "Revive 50%/wave" },
  { id: "u1", name: "Swiftness I", region: "utility", cost: 1, conns: ["center", "u2", "u3"], px: .62, py: .5, effects: "+5% move spd" },
  { id: "u2", name: "Collector I", region: "utility", cost: 1, conns: ["u1", "u4", "u5"], px: .72, py: .42, effects: "+15% pickup" },
  { id: "u3", name: "Fortune I", region: "utility", cost: 1, conns: ["u1", "u6", "mc2"], px: .68, py: .58, effects: "+3% drop" },
  { id: "u4", name: "Swiftness II", region: "utility", cost: 1, conns: ["u2", "u7"], px: .8, py: .35, effects: "+8% move spd" },
  { id: "u5", name: "Scholar I", region: "utility", cost: 1, conns: ["u2", "u7", "u8"], px: .78, py: .48, effects: "+10% XP" },
  { id: "u6", name: "Fortune II", region: "utility", cost: 1, conns: ["u3", "u8", "u9"], px: .75, py: .65, effects: "+5% drop" },
  { id: "u7", name: "Swiftness III", region: "utility", cost: 1, conns: ["u4", "u5", "u10"], px: .88, py: .4, effects: "+10% move" },
  { id: "u8", name: "Lucky Drops", region: "utility", cost: 1, conns: ["u5", "u6", "u10"], px: .85, py: .55, effects: "+1 rarity" },
  { id: "u9", name: "War Aura", region: "utility", cost: 1, conns: ["u6", "u11"], px: .78, py: .75, effects: "+10% ally dmg" },
  { id: "u10", name: "Scholar II", region: "utility", cost: 1, conns: ["u7", "u8", "u11"], px: .92, py: .5, effects: "+15% XP" },
  { id: "u11", name: "Collector II", region: "utility", cost: 1, conns: ["u9", "u10"], px: .9, py: .68, effects: "+30% pickup" },
  { id: "mc1", name: "Berserker", region: "major", cost: 2, conns: ["c3", "d3"], px: .45, py: .5, effects: "+30% dmg <30%HP" },
  { id: "mc2", name: "Scavenger", region: "major", cost: 2, conns: ["d9", "u3"], px: .6, py: .72, effects: "+10% drop+rarity" },
];
export const SKILL_MAP = new Map(SKILL_NODES.map(n => [n.id, n]));
export const REGION_COLORS = { combat: "#ff6b6b", defense: "#4ade80", utility: "#60a5fa", center: "#fbbf24", major: "#c084fc" };
