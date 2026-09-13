/* Snapback 4 on a device: the native module's C ABI. One JSON call.
 *
 *   sb4_device *d = sb4_open("/data/bob.sqlite", backend_json);   // GET /schema's JSON
 *   char *answer = sb4_call(d, "{\"op\":\"query\",\"name\":\"thread\",\"viewer\":\"dev:bob\",\"args\":{\"conversationId\":\"c1\"},\"now\":1789200000000}");
 *   ... answer is {"ok": ...} or {"denied": {"code","family","message",...}} ...
 *   sb4_free(answer);
 *   sb4_close(d);
 *
 * Ops: state, adopt {backend}, apply {page, first}, query {name, viewer, args, now},
 * predict {name, viewer, args, now, newIds, entropy}, withdraw {predicted},
 * enqueue {entry}, queued, next_submission, dequeue {id}, meta {key},
 * set_meta {key, value}, clear_rows. Nothing panics across this boundary;
 * every answer is JSON the caller frees. A device is not thread-safe: one
 * caller at a time, as the store is one transaction at a time.
 */
#ifndef SNAPBACK4_H
#define SNAPBACK4_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct sb4_device sb4_device;

/* Open the device's store at `path` for the backend; NULL when it refuses
 * (ask `sb4_open_reason` why). */
sb4_device *sb4_open(const char *path, const char *backend_json);

/* Why `sb4_open` would refuse, as JSON to free: {"ok":true} when it would open. */
char *sb4_open_reason(const char *path, const char *backend_json);

/* One call; the answer is JSON to free with `sb4_free`. */
char *sb4_call(sb4_device *device, const char *request_json);

void sb4_free(char *text);
void sb4_close(sb4_device *device);

#ifdef __cplusplus
}
#endif

#endif
