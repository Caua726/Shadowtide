#ifndef RENDER_H
#define RENDER_H

#include "game.h"
#include <raylib.h>

typedef struct {
    float offsetX, offsetY;
} Camera2DState;

void render_update_camera(Camera2DState *cam, GameState *gs, float screenW, float screenH);
void render_world(Camera2DState *cam, GameState *gs);

// Rarity color helper
Color rarity_color(int rarity);

#endif
