// DAYON - Treino: the Dayon account on this device (email and password, Firebase) and its sync
// with the Dayon cloud (docs/dayon/PAINEL.md). Optional: without an account nothing here runs and
// nothing calls Firebase; the app keeps its copy in localStorage (and the phone's file) as always.
//
// Which destination a device syncs to: the Dayon cloud only while the device is NOT signed in to
// a self-hosted server (useStore `user`: a paired phone, or the self-hosted web app). With both,
// the server wins and the Dayon sync waits ('paused'): two destinations merging each other's
// copies would only make it hard to tell where a change went.
import { create } from 'zustand'
import { useStore, DEF, hasData } from './useStore.js'
import { dayonAvailable, CLOUD_SITE } from '../lib/dayon-config.js'
import { dayonMessage, isOffline } from '../lib/dayon-errors.js'
import { syncOnce, owesCloud } from '../lib/dayon-sync.js'
import { t } from '../lib/i18n.js'

const UID_KEY = 'dayon_uid'       // signed in to Dayon on this device: boot loads the SDK
const OWNER_KEY = 'dayon_owner'   // the Dayon account this device's copy last synced with
const DEBOUNCE_MS = 1500          // like the self-hosted push (useStore pushState)
const POLL_MS = 5 * 60 * 1000     // while open: a trainer's plan change shows up within minutes
const RESUME_MIN_MS = 60 * 1000   // coming back to the app reads again, at most this often
const RETRY_MS = [30000, 60000, 120000, 300000]

const ls = () => { try { return globalThis.localStorage || null } catch { return null } }
const read = k => { try { return ls()?.getItem(k) ?? null } catch { return null } }
const write = (k, v) => { try { if (v == null) ls()?.removeItem(k); else ls()?.setItem(k, v) } catch { /* storage blocked */ } }
const memory = new Map()
const storage = () => ls() || { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) }
const cloudApi = () => import('../lib/dayon-cloud.js')

let started = false
let debounceTm = null
let retryTm = null
let pollTm = null
let retries = 0
let running = null
let again = false
let applying = false
let lastRead = 0

// While the store shows a stand-in copy (the tour's practice, or a trainer editing a student's
// plan: useStore enterTourSandbox), that copy is not this account's and must never be synced into
// it. A sync that meets one stops where it is and runs again once the real copy is back.
const inSandbox = () => !!useStore.getState().tourSandbox
const busy = () => Object.assign(new Error('dayon/busy'), { code: 'dayon/busy' })
const toastSoon = m => import('./useUI.js').then(({ useUI }) => useUI.getState().toast(m)).catch(() => {})

export const useDayon = create((set, get) => {
  const pausedByServer = () => !!useStore.getState().user
  const scheduleRetry = () => {
    clearTimeout(retryTm)
    const ms = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]
    retries++
    retryTm = setTimeout(() => get().syncNow(), ms)
  }
  const poll = () => {
    clearTimeout(pollTm)
    pollTm = setTimeout(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') get().syncNow()
      poll()
    }, POLL_MS)
  }
  const cloud = {
    read: async (uid, since) => (await cloudApi()).lerNuvem(uid, since),
    write: async (uid, writes, expect) => (await cloudApi()).gravarNuvem(uid, writes, expect),
  }

  // Someone is signed in (or no longer is) on this device.
  // `perfil` from criarConta / entrar is applied at once so Settings → Account shows the
  // name and student role without waiting for a second read. Auth fires as soon as the
  // account exists, before that first write lands, so a later empty read must not wipe it.
  const setSignedIn = (u, perfil) => {
    write(UID_KEY, u.uid)
    const owner = read(OWNER_KEY)
    // This device's copy belongs to another Dayon account: ask before mixing the two.
    const choice = !!owner && owner !== u.uid && hasData(useStore.getState().S)
    const prev = get()
    const same = prev.user?.uid === u.uid
    const nome = (perfil && perfil.nome) || u.displayName || (same ? prev.user.nome : '') || ''
    set({
      user: { uid: u.uid, email: u.email || '', nome },
      perfil: perfil || (same ? prev.perfil : null),
      choice, authReady: true, error: null,
    })
    return choice
  }
  const onUser = async u => {
    if (!u) {
      if (get().user) write(UID_KEY, null)
      set({ user: null, perfil: null, status: 'off', choice: false, authReady: true })
      return
    }
    const choice = setSignedIn(u)
    cloudApi().then(c => c.lerPerfil(u.uid)).then(perfil => {
      if (get().user?.uid !== u.uid || !perfil) return
      set({ perfil, user: { ...get().user, nome: perfil.nome || get().user.nome } })
    }).catch(() => {})
    if (!choice) get().syncNow()
  }

  return {
    available: dayonAvailable(),
    authReady: false,
    user: null,       // { uid, email, nome }
    perfil: null,     // users/{uid}: { nome, papel, email }
    // 'off' | 'syncing' | 'ok' | 'offline' | 'error' | 'paused'
    status: 'off',
    lastSync: 0,
    error: null,
    choice: false,    // signed in over another Dayon account's copy: merge or cancel (resolveChoice)

    // Once, from App. Loads Firebase only when someone signed in here before (or on the website).
    async start() {
      if (started) return
      started = true
      if (!get().available) { set({ authReady: true }); return }
      useStore.subscribe((s, prev) => {
        // Back from a stand-in copy: what waited meanwhile goes now.
        if (prev.tourSandbox && !s.tourSandbox && get().user) { get().syncNow(); return }
        if (s.S !== prev.S && !applying) get().changed()
        if ((s.user?.id || null) !== (prev.user?.id || null) && get().user) get().syncNow()
      })
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => { if (get().user) get().syncNow() })
        document.addEventListener?.('visibilitychange', () => {
          if (document.visibilityState === 'visible' && get().user && Date.now() - lastRead > RESUME_MIN_MS) get().syncNow()
        })
      }
      if (!CLOUD_SITE && !read(UID_KEY)) { set({ authReady: true }); return }
      try { await get().listen() }
      catch (e) { set({ authReady: true, status: 'error', error: dayonMessage(e) }) }
    },

    async signUp(f) {
      const c = await cloudApi()
      const { user, perfil } = await c.criarConta(f)
      setSignedIn(user, perfil)
      await get().listen()
    },
    async signIn(f) {
      const c = await cloudApi()
      const { user, perfil } = await c.entrar(f)
      setSignedIn(user, perfil)
      await get().listen()
    },
    // After a sign-in from the screen: start following the account (start() may have skipped it).
    listening: false,
    async listen() {
      if (get().listening) return
      set({ listening: true })
      try { await (await cloudApi()).watchAuth(onUser) }
      catch (e) { set({ listening: false }); throw e }
      poll()
    },
    async resetPassword(email) { await (await cloudApi()).esqueciSenha(email) },

    // Signing out keeps this device's copy as it is (and who it belonged to).
    async signOut() {
      clearTimeout(debounceTm); clearTimeout(retryTm)
      const uid = get().user?.uid
      if (uid && !get().choice && owesCloud(useStore.getState().S, storage(), uid)) {
        try { await get().syncNow() } catch { /* stays here; goes up on the next sign-in */ }
      }
      await (await cloudApi()).sair()
      write(UID_KEY, null)
      set({ user: null, perfil: null, status: 'off', choice: false, error: null })
    },

    resolveChoice(merge) {
      if (!merge) return get().signOut()
      set({ choice: false })
      get().syncNow()
    },

    // A change on this device: after a moment, and only when there is something to send. A set
    // ticked during a workout changes only the running workout, which never goes to the cloud.
    changed() {
      const uid = get().user?.uid
      if (!uid || get().choice || pausedByServer() || inSandbox()) return
      clearTimeout(debounceTm)
      debounceTm = setTimeout(() => {
        if (owesCloud(useStore.getState().S, storage(), uid)) get().syncNow()
      }, DEBOUNCE_MS)
    },

    async syncNow() {
      const uid = get().user?.uid
      if (!uid || get().choice) return
      if (pausedByServer()) { set({ status: 'paused' }); return }
      if (!useStore.getState().ready) { clearTimeout(retryTm); retryTm = setTimeout(() => get().syncNow(), 1000); return }
      if (inSandbox()) return
      if (running) { again = true; return running }
      clearTimeout(debounceTm)
      const was = get().status
      set({ status: 'syncing' })
      running = (async () => {
        try {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Object.assign(new Error('offline'), { code: 'dayon/offline' })
          const r = await syncOnce({
            uid, storage: storage(), defaults: DEF,
            cloud: {
              read: cloud.read,
              write: async (...a) => { if (inSandbox()) throw busy(); return cloud.write(...a) },
            },
            getState: () => { if (inSandbox()) throw busy(); return useStore.getState().S },
            applyState: S => {
              if (inSandbox()) throw busy()
              applying = true
              try { useStore.getState().replaceState(S, false) } finally { applying = false }
            },
          })
          lastRead = Date.now()
          write(OWNER_KEY, uid)
          retries = 0
          clearTimeout(retryTm)
          set({ status: 'ok', lastSync: Date.now(), error: r.tooBig?.length ? dayonMessage({ code: 'dayon/too-big' }) : null })
          // A trainer changed the plan and this sync brought it in: a short word, not a dialog.
          if (r.planBy) toastSoon(t('Plan updated by your trainer'))
        } catch (e) {
          // A stand-in copy came up meanwhile: nothing was written; the sync runs once it goes.
          if (e?.code === 'dayon/busy') set({ status: was === 'syncing' ? 'ok' : was })
          else if (isOffline(e) || e?.code === 'dayon/conflict') { set({ status: 'offline', error: null }); scheduleRetry() }
          else set({ status: 'error', error: dayonMessage(e) })
        } finally {
          running = null
          if (again) { again = false; get().syncNow() }
        }
      })()
      return running
    },

    // The website, signing out on a shared computer: this browser's copy goes too, on request.
    forgetDevice() {
      for (const k of ['gym_state_v1', 'gym_sync', 'gym_state_wid', 'gym_state_owner', 'gym_dirty', OWNER_KEY, UID_KEY]) write(k, null)
      try { for (const k of Object.keys(ls() || {})) if (k.startsWith('dayon_sync_')) write(k, null) } catch { /* nothing more to clear */ }
    },
  }
})
