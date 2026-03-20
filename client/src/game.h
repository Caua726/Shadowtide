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
    char id[ID_LEN];
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
