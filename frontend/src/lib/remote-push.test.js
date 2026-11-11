// DAYON - Treino remote push (remote-push.js): permission, token, topics, and above all the build
// without Firebase files, where nothing may break.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')
  const store = new Map()
  vi.stubGlobal('localStorage', { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() })
  return { platform: 'ios', available: true, plugin: null, registered: 0, scheduled: [] }
})

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => h.platform, isPluginAvailable: () => h.available },
  registerPlugin: () => { h.registered++; return h.plugin },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { schedule: async opts => { h.scheduled.push(opts) } },
}))

const NOT_CONFIGURED_IOS = 'Firebase is not configured: GoogleService-Info.plist is missing from the app bundle.'

function fakePlugin({ receive = 'granted', token = 'tok-123', getToken, subscribe, check } = {}) {
  const listeners = {}
  const p = {
    subscribed: [],
    listeners,
    checkPermissions: vi.fn(check || (async () => ({ receive }))),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' })),
    getToken: vi.fn(getToken || (async () => ({ token }))),
    subscribeToTopic: vi.fn(subscribe || (async ({ topic }) => { p.subscribed.push(topic) })),
    addListener: vi.fn(async (ev, fn) => { listeners[ev] = fn; return { remove: async () => {} } }),
  }
  return p
}

let mod
beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  h.platform = 'ios'
  h.available = true
  h.registered = 0
  h.scheduled = []
  h.plugin = fakePlugin()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  mod = await import('./remote-push.js')
  mod._resetRemotePush()
})

describe('topicsFor', () => {
  it('everyone joins "todos", then their platform', () => {
    expect(mod.topicsFor('ios')).toEqual(['todos', 'ios'])
    expect(mod.topicsFor('android')).toEqual(['todos', 'android'])
    expect(mod.topicsFor('web')).toEqual(['todos'])
  })
})

describe('startRemotePush', () => {
  it('with the permission and Firebase set up: keeps the token and joins "todos" and "ios"', async () => {
    const res = await mod.startRemotePush()
    expect(res).toEqual({ status: 'ready', token: 'tok-123', topics: ['todos', 'ios'] })
    expect(h.plugin.subscribed).toEqual(['todos', 'ios'])
    expect(localStorage.getItem(mod.TOKEN_KEY)).toBe('tok-123')
    expect(JSON.parse(localStorage.getItem(mod.TOPICS_KEY))).toEqual(['todos', 'ios'])
  })

  it('Android joins "todos" and "android"', async () => {
    h.platform = 'android'
    const res = await mod.startRemotePush()
    expect(res.topics).toEqual(['todos', 'android'])
  })

  it('never asks for the permission itself: without it, nothing is registered', async () => {
    h.plugin = fakePlugin({ receive: 'prompt' })
    const res = await mod.startRemotePush()
    expect(res.status).toBe('no-permission')
    expect(h.plugin.requestPermissions).not.toHaveBeenCalled()
    expect(h.plugin.getToken).not.toHaveBeenCalled()
    expect(h.plugin.subscribeToTopic).not.toHaveBeenCalled()
  })

  it('a denied permission registers nothing either, and a later start may try again', async () => {
    h.plugin = fakePlugin({ receive: 'denied' })
    expect((await mod.startRemotePush()).status).toBe('no-permission')
    h.plugin.checkPermissions.mockImplementation(async () => ({ receive: 'granted' }))
    expect((await mod.startRemotePush()).status).toBe('ready')
  })

  it('iPhone without GoogleService-Info.plist: not-configured, no throw, no topics', async () => {
    h.plugin = fakePlugin({ getToken: async () => { throw new Error(NOT_CONFIGURED_IOS) } })
    const res = await mod.startRemotePush()
    expect(res).toEqual({ status: 'not-configured' })
    expect(h.plugin.subscribeToTopic).not.toHaveBeenCalled()
    expect(localStorage.getItem(mod.TOKEN_KEY)).toBeNull()
  })

  it('Android without google-services.json: not-configured, no throw', async () => {
    h.platform = 'android'
    h.plugin = fakePlugin({ getToken: async () => { throw new Error('Default FirebaseApp is not initialized in this process com.dayon.treino. Make sure to call FirebaseApp.initializeApp(Context) first.') } })
    expect((await mod.startRemotePush()).status).toBe('not-configured')
  })

  it('a build without the native plugin at all: not-configured, the plugin is never made', async () => {
    h.available = false
    const res = await mod.startRemotePush()
    expect(res.status).toBe('not-configured')
    expect(h.registered).toBe(0)
  })

  it('a failed topic is logged and skipped; the others still join', async () => {
    h.plugin = fakePlugin({ subscribe: async ({ topic }) => { if (topic === 'todos') throw new Error('network'); h.plugin.subscribed.push(topic) } })
    const res = await mod.startRemotePush()
    expect(res.status).toBe('ready')
    expect(res.topics).toEqual(['ios'])
  })

  it('a token error that is not about setup resolves to error, never rejects', async () => {
    h.plugin = fakePlugin({ getToken: async () => { throw new Error('APNS token not set') } })
    await expect(mod.startRemotePush()).resolves.toEqual({ status: 'error' })
  })

  it('a permission check that throws does not reach the app', async () => {
    h.plugin = fakePlugin({ check: async () => { throw new Error('boom') } })
    await expect(mod.startRemotePush()).resolves.toEqual({ status: 'error' })
  })

  it('off the phone app it does nothing', async () => {
    const res = await mod.startRemotePush({ mobile: false })
    expect(res.status).toBe('off')
    expect(h.registered).toBe(0)
  })

  it('once per app start', async () => {
    await mod.startRemotePush()
    await mod.startRemotePush()
    expect(h.plugin.getToken).toHaveBeenCalledTimes(1)
  })

  it('a new token is kept and the topics joined again', async () => {
    await mod.startRemotePush()
    h.plugin.subscribed.length = 0
    h.plugin.listeners.tokenReceived({ token: 'tok-new' })
    await new Promise(r => setTimeout(r, 0))
    expect(localStorage.getItem(mod.TOKEN_KEY)).toBe('tok-new')
    expect(h.plugin.subscribed).toEqual(['todos', 'ios'])
  })

  it('Android shows a push that arrives with the app open as a local notification', async () => {
    h.platform = 'android'
    await mod.startRemotePush()
    h.plugin.listeners.notificationReceived({ notification: { title: 'Oi', body: 'Treino novo' } })
    await new Promise(r => setTimeout(r, 0))
    expect(h.scheduled[0].notifications[0]).toMatchObject({ title: 'Oi', body: 'Treino novo' })
  })

  it('iOS leaves the foreground banner to the system', async () => {
    await mod.startRemotePush()
    expect(h.plugin.listeners.notificationReceived).toBeUndefined()
  })
})

describe('isNotConfigured', () => {
  it('knows the setup errors from both platforms and nothing else', () => {
    expect(mod.isNotConfigured(new Error(NOT_CONFIGURED_IOS))).toBe(true)
    expect(mod.isNotConfigured({ code: 'UNAVAILABLE', message: 'x' })).toBe(true)
    expect(mod.isNotConfigured(new Error('Default FirebaseApp is not initialized'))).toBe(true)
    expect(mod.isNotConfigured(new Error('network down'))).toBe(false)
    expect(mod.isNotConfigured(undefined)).toBe(false)
  })
})
