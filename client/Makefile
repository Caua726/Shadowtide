# client/Makefile
CC = gcc
CFLAGS = -Wall -Wextra -std=c11 -O2 -Ideps/cJSON
LDFLAGS = -lraylib -lwebsockets -lm -lpthread

# Platform detection
UNAME := $(shell uname -s)
ifeq ($(UNAME),Linux)
    LDFLAGS += -lGL -ldl
endif

SRC = src/main.c src/network.c src/protocol.c src/game.c src/render.c src/ui.c src/input.c deps/cJSON/cJSON.c
OBJ = $(SRC:.c=.o)
BIN = shadowtide

all: $(BIN)

$(BIN): $(OBJ)
	$(CC) $(OBJ) -o $@ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJ) $(BIN)

.PHONY: all clean
