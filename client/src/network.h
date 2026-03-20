// client/src/network.h
#ifndef NETWORK_H
#define NETWORK_H

#include <stdbool.h>
#include <pthread.h>

#define MSG_QUEUE_SIZE 256
#define MSG_MAX_LEN    16384

typedef struct {
    char (*messages)[MSG_MAX_LEN]; // heap-allocated: malloc(MSG_QUEUE_SIZE * MSG_MAX_LEN)
    int head;
    int tail;
    pthread_mutex_t mutex;
} MessageQueue;

void mq_init(MessageQueue *q);
bool mq_enqueue(MessageQueue *q, const char *msg);
bool mq_dequeue(MessageQueue *q, char *out, int out_len);
bool mq_empty(MessageQueue *q);

// Network state
typedef enum {
    NET_DISCONNECTED,
    NET_CONNECTING,
    NET_CONNECTED,
} NetState;

typedef struct {
    MessageQueue inbox;   // server → client
    MessageQueue outbox;  // client → server
    NetState state;
    bool running;
    pthread_t thread;
    char host[256];
    int port;
    char player_name[32];
} NetworkContext;

void net_init(NetworkContext *ctx, const char *host, int port, const char *name);
void net_start(NetworkContext *ctx);
void net_stop(NetworkContext *ctx);
void net_send(NetworkContext *ctx, const char *json_msg);

#endif
