#ifndef INPUT_H
#define INPUT_H

#include "game.h"
#include "network.h"
#include <stdbool.h>

typedef struct {
    bool showAttributes;
    bool showSkillTree;
    int selectedSkillNode;  // index into skill tree node list, -1 = none
} InputState;

void input_init(InputState *is);
void input_update(InputState *is, GameState *gs, NetworkContext *net, float screenW, float screenH);

#endif
