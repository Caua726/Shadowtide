// client/src/protocol.c
#include "protocol.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

// === String mapping tables ===

static const char *WEAPON_STRINGS[] = {
    "sword", "hammer", "bow", "staff", "pistol", "shotgun", "arcaneOrb"
};

int weapon_type_from_string(const char *s) {
    if (!s) return WEAPON_NONE;
    for (int i = 0; i < WEAPON_COUNT; i++)
        if (strcmp(s, WEAPON_STRINGS[i]) == 0) return i;
    return WEAPON_NONE;
}

const char *weapon_type_to_string(int type) {
    if (type < 0 || type >= WEAPON_COUNT) return "";
    return WEAPON_STRINGS[type];
}

static const char *ENEMY_STRINGS[] = {
    "slime", "skeleton", "archer", "wolf", "golem", "necromancer", "creeper", "sorcerer"
};

int enemy_type_from_string(const char *s) {
    if (!s) return 0;
    for (int i = 0; i < ENEMY_COUNT; i++)
        if (strcmp(s, ENEMY_STRINGS[i]) == 0) return i;
    return 0;
}

static const char *SPELL_STRINGS[] = {
    "fireball", "iceRay", "magicShield", "heal", "meteor",
    "chainLightning", "teleport", "summonSpirits", "arcaneStorm", "blackHole"
};

int spell_id_from_string(const char *s) {
    if (!s || !s[0]) return SPELL_NONE;
    for (int i = 0; i < SPELL_COUNT; i++)
        if (strcmp(s, SPELL_STRINGS[i]) == 0) return i;
    return SPELL_NONE;
}

const char *spell_id_to_string(int id) {
    if (id < 0 || id >= SPELL_COUNT) return "";
    return SPELL_STRINGS[id];
}

int wave_state_from_string(const char *s) {
    if (!s) return WAVE_WAITING;
    if (strcmp(s, "combat") == 0) return WAVE_COMBAT;
    if (strcmp(s, "pause") == 0) return WAVE_PAUSE;
    return WAVE_WAITING;
}

ServerMsgType server_msg_type(const char *type_str) {
    if (!type_str) return MSG_UNKNOWN;
    if (strcmp(type_str, "identity") == 0) return MSG_IDENTITY;
    if (strcmp(type_str, "state_sync") == 0) return MSG_STATE_SYNC;
    if (strcmp(type_str, "state_patch") == 0) return MSG_STATE_PATCH;
    if (strcmp(type_str, "event") == 0) return MSG_EVENT;
    return MSG_UNKNOWN;
}

// === Message builders ===

static char *json_to_string(cJSON *obj) {
    char *str = cJSON_PrintUnformatted(obj);
    cJSON_Delete(obj);
    return str;
}

char *msg_move(float x, float y) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "move");
    cJSON_AddNumberToObject(m, "x", x);
    cJSON_AddNumberToObject(m, "y", y);
    return json_to_string(m);
}

char *msg_aim(float x, float y) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "aim");
    cJSON_AddNumberToObject(m, "x", x);
    cJSON_AddNumberToObject(m, "y", y);
    return json_to_string(m);
}

char *msg_attack(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "attack");
    return json_to_string(m);
}

char *msg_cast_spell(int slot, float targetX, float targetY) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "cast_spell");
    cJSON_AddNumberToObject(m, "slot", slot);
    cJSON_AddNumberToObject(m, "targetX", targetX);
    cJSON_AddNumberToObject(m, "targetY", targetY);
    return json_to_string(m);
}

char *msg_pickup_item(const char *itemId) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "pickup_item");
    cJSON_AddStringToObject(m, "itemId", itemId);
    return json_to_string(m);
}

char *msg_pickup_spell(const char *itemId) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "pickup_spell");
    cJSON_AddStringToObject(m, "itemId", itemId);
    return json_to_string(m);
}

char *msg_swap_weapon(int slot) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "swap_weapon");
    cJSON_AddNumberToObject(m, "slot", slot);
    return json_to_string(m);
}

char *msg_drop_weapon(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "drop_weapon");
    return json_to_string(m);
}

char *msg_allocate_points(int str, int dex, int vit, int intel, int lck) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "allocate_points");
    cJSON_AddNumberToObject(m, "str", str);
    cJSON_AddNumberToObject(m, "dex", dex);
    cJSON_AddNumberToObject(m, "vit", vit);
    cJSON_AddNumberToObject(m, "intel", intel);
    cJSON_AddNumberToObject(m, "lck", lck);
    return json_to_string(m);
}

char *msg_activate_node(const char *nodeId) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "activate_node");
    cJSON_AddStringToObject(m, "nodeId", nodeId);
    return json_to_string(m);
}

char *msg_reset_tree(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "reset_tree");
    return json_to_string(m);
}

char *msg_debug(const char *cmd, cJSON *extra) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "debug");
    cJSON_AddStringToObject(m, "cmd", cmd);
    if (extra) {
        cJSON *child = extra->child;
        while (child) {
            cJSON *next = child->next;
            cJSON_DetachItemViaPointer(extra, child);
            cJSON_AddItemToObject(m, child->string, child);
            child = next;
        }
        cJSON_Delete(extra);
    }
    return json_to_string(m);
}

char *msg_reset_game(void) {
    cJSON *m = cJSON_CreateObject();
    cJSON_AddStringToObject(m, "type", "reset_game");
    return json_to_string(m);
}
