import Echo from 'laravel-echo'
import Pusher from 'pusher-js'
import { createNoopEcho, isLocalHost, shouldEnableRealtime } from '@/services/realtimeClient'

const PusherClient = Pusher?.default || Pusher

const appKey =
  import.meta.env.VITE_REVERB_APP_KEY ||
  import.meta.env.VITE_PUSHER_APP_KEY ||
  'local'

const configuredHost =
  import.meta.env.VITE_REVERB_HOST ||
  import.meta.env.VITE_PUSHER_HOST ||
  ''

// Without an explicit host, only fall back to the page host for local development.
const wsHost =
  configuredHost || (isLocalHost(window.location.hostname) ? window.location.hostname : '')

const wsPort =
  Number(import.meta.env.VITE_REVERB_PORT || import.meta.env.VITE_PUSHER_PORT) ||
  (window.location.port ? Number(window.location.port) : (window.location.protocol === 'https:' ? 443 : 80))

const isHttps = window.location.protocol === 'https:'

const createEcho = () => {
  if (!shouldEnableRealtime(wsHost)) {
    console.info('[Echo] Real-time updates disabled: no reachable Reverb host configured.')
    return createNoopEcho()
  }

  window.Pusher = PusherClient
  try {
    return new Echo({
      broadcaster: 'pusher',
      // Pass the constructor via `Pusher`; `client` expects a ready Pusher instance.
      Pusher: PusherClient,
      key: appKey,
      wsHost,
      wsPort,
      wssPort: wsPort,
      forceTLS: isHttps,
      disableStats: true,
      enabledTransports: ['ws', 'wss'],
      cluster: import.meta.env.VITE_PUSHER_APP_CLUSTER || 'mt1'
    })
  } catch (err) {
    // A failing socket client must never take down module load (and with it every page that
    // imports this file). Degrade to the no-op client; callers fall back to fetch/polling.
    console.warn('[Echo] Could not create the real-time client; real-time updates disabled.', err)
    return createNoopEcho()
  }
}

const echo = createEcho()

export default echo
