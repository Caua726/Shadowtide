#ifndef UI_H
#define UI_H

#include "game.h"
#include "input.h"
#include "network.h"
#include "render.h"

void ui_draw(GameState *gs, InputState *is, NetworkContext *net, float screenW, float screenH);

#endif
