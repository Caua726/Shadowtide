// client/src/network.c
#include "network.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <libwebsockets.h>

// === Message Queue ===

void mq_init(MessageQueue *q) {
    q->messages = malloc(MSG_QUEUE_SIZE * MSG_MAX_LEN);
    q->head = 0;
    q->tail = 0;
    pthread_mutex_init(&q->mutex, NULL);
}

bool mq_enqueue(MessageQueue *q, const char *msg) {
    pthread_mutex_lock(&q->mutex);
    int next = (q->tail + 1) % MSG_QUEUE_SIZE;
    if (next == q->head) {
        // Full — discard oldest
        q->head = (q->head + 1) % MSG_QUEUE_SIZE;
    }
    strncpy(q->messages[q->tail], msg, MSG_MAX_LEN - 1);
    q->messages[q->tail][MSG_MAX_LEN - 1] = '\0';
    q->tail = next;
    pthread_mutex_unlock(&q->mutex);
    return true;
}

bool mq_dequeue(MessageQueue *q, char *out, int out_len) {
    pthread_mutex_lock(&q->mutex);
    if (q->head == q->tail) {
        pthread_mutex_unlock(&q->mutex);
        return false;
    }
    strncpy(out, q->messages[q->head], out_len - 1);
    out[out_len - 1] = '\0';
    q->head = (q->head + 1) % MSG_QUEUE_SIZE;
    pthread_mutex_unlock(&q->mutex);
    return true;
}

bool mq_empty(MessageQueue *q) {
    pthread_mutex_lock(&q->mutex);
    bool empty = (q->head == q->tail);
    pthread_mutex_unlock(&q->mutex);
    return empty;
}

// === WebSocket Client ===

static NetworkContext *g_ctx = NULL;
static struct lws *g_wsi = NULL;
static unsigned char g_recv_buf[MSG_MAX_LEN];
static int g_recv_len = 0;

static int ws_callback(struct lws *wsi, enum lws_callback_reasons reason,
                       void *user, void *in, size_t len) {
    (void)user;

    switch (reason) {
    case LWS_CALLBACK_CLIENT_ESTABLISHED:
        g_ctx->state = NET_CONNECTED;
        lws_callback_on_writable(wsi);
        break;

    case LWS_CALLBACK_CLIENT_RECEIVE: {
        // Accumulate fragments
        if (g_recv_len + (int)len < MSG_MAX_LEN - 1) {
            memcpy(g_recv_buf + g_recv_len, in, len);
            g_recv_len += (int)len;
        }
        if (lws_is_final_fragment(wsi)) {
            g_recv_buf[g_recv_len] = '\0';
            mq_enqueue(&g_ctx->inbox, (char *)g_recv_buf);
            g_recv_len = 0;
        }
        break;
    }

    case LWS_CALLBACK_CLIENT_WRITEABLE: {
        char msg[MSG_MAX_LEN];
        if (mq_dequeue(&g_ctx->outbox, msg, MSG_MAX_LEN)) {
            int msglen = (int)strlen(msg);
            unsigned char buf[LWS_PRE + MSG_MAX_LEN];
            memcpy(&buf[LWS_PRE], msg, msglen);
            lws_write(wsi, &buf[LWS_PRE], msglen, LWS_WRITE_TEXT);
        }
        // Always request writable callback to drain outbox
        if (!mq_empty(&g_ctx->outbox)) {
            lws_callback_on_writable(wsi);
        }
        break;
    }

    case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
    case LWS_CALLBACK_CLIENT_CLOSED:
        g_ctx->state = NET_DISCONNECTED;
        g_wsi = NULL;
        g_recv_len = 0;
        break;

    default:
        break;
    }

    return 0;
}

static const struct lws_protocols protocols[] = {
    { "shadowtide", ws_callback, 0, MSG_MAX_LEN },
    { NULL, NULL, 0, 0 }
};

static void *network_thread(void *arg) {
    NetworkContext *ctx = (NetworkContext *)arg;
    g_ctx = ctx;

    while (ctx->running) {
        struct lws_context_creation_info info;
        memset(&info, 0, sizeof(info));
        info.port = CONTEXT_PORT_NO_LISTEN;
        info.protocols = protocols;
        info.options = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;

        struct lws_context *context = lws_create_context(&info);
        if (!context) {
            sleep(2);
            continue;
        }

        // Build path with URL-encoded name query param
        char encoded_name[128] = "";
        {
            int j = 0;
            for (int i = 0; ctx->player_name[i] && j < (int)sizeof(encoded_name) - 4; i++) {
                char c = ctx->player_name[i];
                if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                    (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') {
                    encoded_name[j++] = c;
                } else {
                    snprintf(encoded_name + j, 4, "%%%02X", (unsigned char)c);
                    j += 3;
                }
            }
            encoded_name[j] = '\0';
        }
        char path[512];
        snprintf(path, sizeof(path), "/ws/raw?name=%s", encoded_name);

        struct lws_client_connect_info ccinfo;
        memset(&ccinfo, 0, sizeof(ccinfo));
        ccinfo.context = context;
        ccinfo.address = ctx->host;
        ccinfo.port = ctx->port;
        ccinfo.path = path;
        ccinfo.host = ctx->host;
        ccinfo.origin = ctx->host;
        ccinfo.protocol = "shadowtide";

        ctx->state = NET_CONNECTING;
        g_wsi = lws_client_connect_via_info(&ccinfo);

        if (!g_wsi) {
            lws_context_destroy(context);
            sleep(2);
            continue;
        }

        // Event loop
        while (ctx->running && ctx->state != NET_DISCONNECTED) {
            lws_service(context, 50);

            // Request writable if we have outgoing messages
            if (g_wsi && !mq_empty(&ctx->outbox)) {
                lws_callback_on_writable(g_wsi);
            }
        }

        lws_context_destroy(context);

        if (ctx->running) {
            // Reconnect delay
            sleep(2);
        }
    }

    return NULL;
}

// === Public API ===

void net_init(NetworkContext *ctx, const char *host, int port, const char *name) {
    memset(ctx, 0, sizeof(*ctx));
    mq_init(&ctx->inbox);
    mq_init(&ctx->outbox);
    ctx->state = NET_DISCONNECTED;
    ctx->running = false;
    strncpy(ctx->host, host, sizeof(ctx->host) - 1);
    ctx->port = port;
    strncpy(ctx->player_name, name, sizeof(ctx->player_name) - 1);
}

void net_start(NetworkContext *ctx) {
    ctx->running = true;
    pthread_create(&ctx->thread, NULL, network_thread, ctx);
}

void net_stop(NetworkContext *ctx) {
    ctx->running = false;
    pthread_join(ctx->thread, NULL);
}

void net_send(NetworkContext *ctx, const char *json_msg) {
    mq_enqueue(&ctx->outbox, json_msg);
}
