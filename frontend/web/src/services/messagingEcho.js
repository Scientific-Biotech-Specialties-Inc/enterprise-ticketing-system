import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import tokenStore from '@/auth/tokenStore';
import { createNoopEcho, isLocalHost, shouldEnableRealtime } from '@/services/realtimeClient';

window.Pusher = Pusher;

const appKey = import.meta.env.VITE_MESSAGING_REVERB_APP_KEY || 'messaging-local-key';

// Local dev: WebSocket connects directly to the messaging-reverb container exposed on port 6002
// via docker-compose. Cloud: only enabled when VITE_MESSAGING_REVERB_HOST is configured.
const configuredHost = import.meta.env.VITE_MESSAGING_REVERB_HOST || '';
const wsHost =
  configuredHost || (isLocalHost(window.location.hostname) ? window.location.hostname : '');
const wsPort = Number(import.meta.env.VITE_MESSAGING_REVERB_PORT) || 6002;
const isHttps = window.location.protocol === 'https:';

let echoInstance = null;


export const getMessagingEcho = () => {
  if (echoInstance) {
    return echoInstance;
  }

  if (!shouldEnableRealtime(wsHost)) {
    echoInstance = createNoopEcho();
    return echoInstance;
  }

  echoInstance = new Echo({
    broadcaster: 'pusher',
    key: appKey,
    wsHost,
    wsPort,
    wssPort: wsPort,
    forceTLS: isHttps,
    disableStats: true,
    enabledTransports: ['ws', 'wss'],
    cluster: 'mt1',
    authEndpoint: '/api/ticketing/messaging/broadcasting/auth',
    // Dynamic auth: custom authorizer reads the latest token each time
    auth: {
      headers: {
        Accept: 'application/json',
      },
    },
    authorizer: (channel, options) => {
      return {
        authorize: (socketId, callback) => {
          const token = tokenStore.getToken();
          fetch('/api/ticketing/messaging/broadcasting/auth', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: token ? `Bearer ${token}` : '',
            },
            body: JSON.stringify({
              socket_id: socketId,
              channel_name: channel.name,
            }),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error(`Auth failed with status ${response.status}`);
              }
              return response.json();
            })
            .then((data) => {
              callback(null, data);
            })
            .catch((error) => {
              console.error('[MessagingEcho] Channel auth error:', error);
              callback(error);
            });
        },
      };
    },
  });

  return echoInstance;
};


export const disconnectMessagingEcho = () => {
  if (echoInstance) {
    echoInstance.disconnect();
    echoInstance = null;
  }
};
