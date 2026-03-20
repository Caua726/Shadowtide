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
