import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

const PusherClient = Pusher?.default || Pusher
window.Pusher = PusherClient

const appKey =
  import.meta.env.VITE_REVERB_APP_KEY ||
  import.meta.env.VITE_PUSHER_APP_KEY ||
  'local'

const wsHost =
  import.meta.env.VITE_REVERB_HOST ||
  import.meta.env.VITE_PUSHER_HOST ||
  window.location.hostname

const wsPort =
  Number(import.meta.env.VITE_REVERB_PORT || import.meta.env.VITE_PUSHER_PORT) ||
  (window.location.port ? Number(window.location.port) : (window.location.protocol === 'https:' ? 443 : 80))

const isHttps = window.location.protocol === 'https:'

const echo = new Echo({
  broadcaster: 'pusher',
  // Pass the constructor via `Pusher`; `client` expects a ready Pusher instance.
  Pusher: PusherClient,
  key: appKey,
  wsHost,
  wsPort,
  forceTLS: isHttps,
  disableStats: true,
  enabledTransports: ['ws', 'wss'],
  cluster: import.meta.env.VITE_PUSHER_APP_CLUSTER || 'mt1'
})

export default echo
