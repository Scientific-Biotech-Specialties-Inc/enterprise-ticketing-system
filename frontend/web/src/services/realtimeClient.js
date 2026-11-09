// Shared guard for Laravel Echo / Reverb clients.
//
// In cloud deployments (Azure Container Apps behind the central auth-proxy) there is no Reverb
// daemon unless one is explicitly configured. Build-time defaults such as `localhost:6001` then
// make pusher-js retry forever and flood the console with WebSocket errors. When real-time is
// not reachable we hand out a no-op client with the same chainable API, so callers keep working
// (they simply never receive push events and rely on their normal fetch/polling paths).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export const isLocalHost = (host) => LOCAL_HOSTS.has(String(host || '').toLowerCase());

/**
 * Decide whether a WebSocket client should be created.
 * - VITE_REALTIME_ENABLED=false always disables it; =true always enables it.
 * - Otherwise a localhost target is only used when the page itself is served from localhost
 *   (local docker-compose dev). A remote page never tries to reach the visitor's own machine.
 */
export const shouldEnableRealtime = (targetHost) => {
  const flag = String(import.meta.env.VITE_REALTIME_ENABLED ?? '').toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true' || flag === '1') return true;
  if (typeof window === 'undefined') return false;
  if (!targetHost) return false;
  if (isLocalHost(targetHost) && !isLocalHost(window.location.hostname)) return false;
  return true;
};

const createNoopChannel = () => {
  const channel = {
    listen: () => channel,
    listenToAll: () => channel,
    stopListening: () => channel,
    stopListeningToAll: () => channel,
    notification: () => channel,
    stopListeningForNotification: () => channel,
    subscribed: () => channel,
    error: () => channel,
    whisper: () => channel,
    listenForWhisper: () => channel,
    stopListeningForWhisper: () => channel,
    here: () => channel,
    joining: () => channel,
    leaving: () => channel,
    unsubscribe: () => {},
  };
  return channel;
};

export const createNoopEcho = () => {
  const channel = createNoopChannel();
  return {
    isNoop: true,
    connector: {
      pusher: { connection: { bind: () => {}, unbind: () => {}, state: 'unavailable' } },
      socketId: () => undefined,
    },
    channel: () => channel,
    private: () => channel,
    encryptedPrivate: () => channel,
    join: () => channel,
    listen: () => channel,
    leave: () => {},
    leaveChannel: () => {},
    leaveAllChannels: () => {},
    socketId: () => undefined,
    disconnect: () => {},
    connect: () => {},
  };
};
