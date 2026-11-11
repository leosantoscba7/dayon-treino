// DAYON - Treino: remote push through Firebase Cloud Messaging (docs/dayon/PUSH.md).
//
// The rest timer and the training reminders stay local notifications (rest-alert.js,
// gym-reminder.js); this file only lets Dayon send a message to every phone from the Firebase
// console. Every phone that allowed notifications joins the FCM topics "todos" and "ios" or
// "android", and the console sends to a topic: no server of ours, no list of tokens to keep.
//
// It never asks for anything itself. The OS permission is the one the first-start step asks for
// (onboarding-perms.js, "notifications"), the same one the first rest asks for: on iOS the
// notification permission covers remote pushes too, and on Android 13+ POST_NOTIFICATIONS does.
// So there is one dialog, never two. Without the permission this does nothing and tries again on
// the next app start.
//
// Without Firebase set up (no GoogleService-Info.plist in the iPhone app, no google-services.json
// in the Android one) the native plugin answers every call with an error, and this file stops
// there: status 'not-configured', nothing else changes, local notifications keep working.
// Nothing here may throw or reject into the app: every failure is logged and swallowed.
//
// The plugin is @capacitor-firebase/messaging, reached through registerPlugin() from
// @capacitor/core instead of the package's own JS entry: that one carries a web fallback built on
// the Firebase JS SDK, which the app neither needs nor installs. `cap sync` still links the native
// half from package.json.
import { MOBILE, nativePlatform } from './mobile.js'

export const PLUGIN = 'FirebaseMessaging'
export const TOPIC_ALL = 'todos'
export const TOKEN_KEY = 'dayon_push_token'
export const TOPICS_KEY = 'dayon_push_topics'

/** The topics a phone joins: everyone's, then its platform's. */
export function topicsFor(platform) {
  return platform === 'ios' || platform === 'android' ? [TOPIC_ALL, platform] : [TOPIC_ALL]
}

// The errors the plugin gives for "Firebase is not set up in this build": iOS says so in words
// (FirebaseMessagingPlugin.swift), Android passes on FirebaseApp's own message.
const NOT_CONFIGURED = /not configured|GoogleService-Info|google-services|FirebaseApp is not initialized|Default FirebaseApp|UNAVAILABLE|not implemented|plugin is not implemented/i
export function isNotConfigured(err) {
  const text = [err?.code, err?.message, typeof err === 'string' ? err : ''].filter(Boolean).join(' ')
  return NOT_CONFIGURED.test(text)
}

const log = (...a) => { try { console.info('[push]', ...a) } catch { /* no console */ } }
const store = (k, v) => { try { localStorage.setItem(k, v) } catch { /* only a record */ } }

// The plugin, made once. Kept in an object and never returned from an async function: the
// Capacitor proxy answers `then` like any method, and on Android that call never settles, so
// awaiting the proxy itself would hang (see rest-alert.native.test.js).
let held = null
async function plugin() {
  if (held) return held
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.isPluginAvailable && !Capacitor.isPluginAvailable(PLUGIN)) return { p: null }
  held = { p: registerPlugin(PLUGIN) }
  return held
}

let started = null

/**
 * Registers this phone for remote pushes when it can: notification permission given and Firebase
 * set up. Resolves to { status, token?, topics? } and never rejects. Status is one of
 * 'off' (not the phone app), 'no-permission', 'not-configured', 'error' or 'ready'.
 * Once per app start; a start without the permission may try again later in the same run.
 */
export function startRemotePush(opts = {}) {
  if (started) return started
  started = run(opts).then(res => {
    if (res.status === 'no-permission' || res.status === 'error') started = null
    return res
  }, err => { started = null; log('failed', err?.message || err); return { status: 'error' } })
  return started
}

async function run({ mobile = MOBILE } = {}) {
  if (!mobile) return { status: 'off' }
  const platform = await nativePlatform()
  if (!platform) return { status: 'off' }
  const { p } = await plugin().catch(() => ({ p: null }))
  if (!p) { log('plugin missing, remote push off'); return { status: 'not-configured' } }

  let receive
  try { receive = (await p.checkPermissions())?.receive } catch (e) {
    if (isNotConfigured(e)) { log('Firebase not set up, remote push off'); return { status: 'not-configured' } }
    log('permission check failed', e?.message || e); return { status: 'error' }
  }
  if (receive !== 'granted') return { status: 'no-permission' }

  let token
  try { token = (await p.getToken())?.token } catch (e) {
    if (isNotConfigured(e)) { log('Firebase not set up, remote push off'); return { status: 'not-configured' } }
    log('no token', e?.message || e); return { status: 'error' }
  }
  if (!token) { log('no token'); return { status: 'error' } }
  store(TOKEN_KEY, token)

  const topics = []
  for (const topic of topicsFor(platform)) {
    try { await p.subscribeToTopic({ topic }); topics.push(topic) } catch (e) { log('topic', topic, 'failed', e?.message || e) }
  }
  store(TOPICS_KEY, JSON.stringify(topics))

  listen(p, platform)
  log('ready', topics.join(', '))
  return { status: 'ready', token, topics }
}

let listening = false
function listen(p, platform) {
  if (listening) return
  listening = true
  // A new token (FCM rotates them now and then): kept, and the topics joined again with it.
  Promise.resolve(p.addListener('tokenReceived', ev => {
    if (!ev?.token) return
    store(TOKEN_KEY, ev.token)
    for (const topic of topicsFor(platform)) Promise.resolve(p.subscribeToTopic({ topic })).catch(() => {})
  })).catch(() => {})
  // A push that arrives with the app open: iOS shows the banner itself (presentationOptions in
  // capacitor.config.json); Android does not, so it is shown here as a local notification.
  if (platform === 'android') {
    Promise.resolve(p.addListener('notificationReceived', ev => { showInApp(ev?.notification).catch(() => {}) })).catch(() => {})
  }
  // Tapping a push only opens the app, which iOS and Android do on their own.
}

const PUSH_LOCAL_ID = 7300
export async function showInApp(n) {
  const title = n?.title || ''
  const body = n?.body || ''
  if (!title && !body) return false
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  await LocalNotifications.schedule({ notifications: [{ id: PUSH_LOCAL_ID, title, body }] })
  return true
}

// Test seam: a fresh app start.
export function _resetRemotePush() { started = null; held = null; listening = false }
