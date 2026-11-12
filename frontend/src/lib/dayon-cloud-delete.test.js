// DAYON - Treino: deleting the Dayon account (lib/dayon-cloud.js apagarConta, Apple 5.1.1(v)).
// Firebase is a stand-in that keeps documents in a Map and records every step in order.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fb = vi.hoisted(() => ({ docs: new Map(), steps: [], failCommit: null, reauthError: null, user: { uid: 'u1', email: 'u1@x.y' }, batchSizes: [] }))
vi.mock('./dayon-config.js', () => ({ firebaseConfig: () => ({ projectId: 'p' }) }))
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/auth', () => ({
  initializeAuth: () => ({ get currentUser() { return fb.user } }),
  indexedDBLocalPersistence: {}, browserLocalPersistence: {},
  EmailAuthProvider: { credential: (email, senha) => ({ email, senha }) },
  reauthenticateWithCredential: async (user, cred) => {
    fb.steps.push(['reauth', user.uid, cred])
    if (fb.reauthError) throw fb.reauthError
  },
  deleteUser: async user => { fb.steps.push(['deleteUser', user.uid]) },
}))
vi.mock('firebase/firestore', () => {
  // A collection is a path; a query is { path, where: [field, value] | null, limit }.
  const matches = (q, path, data) => {
    const parent = path.split('/').slice(0, -1).join('/')
    if (parent !== q.path) return false
    return !q.where || data[q.where[0]] === q.where[1]
  }
  return {
    initializeFirestore: () => ({}),
    doc: (_db, ...p) => ({ path: p.join('/') }),
    collection: (_db, ...p) => ({ path: p.join('/'), where: null, limit: Infinity }),
    where: (f, op, v) => ({ where: [f, v] }),
    limit: n => ({ limit: n }),
    query: (q, ...parts) => Object.assign({}, q, ...parts),
    getDocs: async q => {
      const docs = [...fb.docs].filter(([p, d]) => matches(q, p, d)).slice(0, q.limit)
        .map(([p, d]) => ({ id: p.split('/').pop(), ref: { path: p }, data: () => d }))
      fb.steps.push(['read', q.path + (q.where ? `?${q.where.join('=')}` : '')])
      return { docs }
    },
    deleteDoc: async ref => { fb.steps.push(['delete', ref.path]); fb.docs.delete(ref.path) },
    writeBatch: () => {
      const ops = []
      return {
        delete: ref => ops.push(ref.path),
        commit: async () => {
          if (fb.failCommit && ops.some(p => p.startsWith(fb.failCommit))) throw Object.assign(new Error('x'), { code: 'unavailable' })
          fb.batchSizes.push(ops.length)
          for (const p of ops) { fb.steps.push(['delete', p]); fb.docs.delete(p) }
        },
      }
    },
  }
})

const { apagarConta } = await import('./dayon-cloud.js')
const { dayonDeleteMessage } = await import('./dayon-errors.js')

const seed = () => {
  fb.docs.clear()
  fb.docs.set('users/u1', { nome: 'Ana', papel: 'personal' })
  fb.docs.set('users/u1/plan/atual', { json: '{}' })
  fb.docs.set('users/u1/estado/atual', { json: '{}' })
  for (let i = 0; i < 1203; i++) fb.docs.set(`users/u1/workouts/w${i}`, { json: '{}' })
  fb.docs.set('vinculos/p9_u1', { personalId: 'p9', alunoId: 'u1', status: 'ativo' })
  fb.docs.set('vinculos/u1_a7', { personalId: 'u1', alunoId: 'a7', status: 'ativo' })
  fb.docs.set('convitesAluno/CODE-1', { personalId: 'u1', ativo: true })
  fb.docs.set('convitesAluno/CODE-2', { personalId: 'u1', ativo: false, usadoPor: 'a7' })
  // Not this account's, and kept: someone else's data, another trainer's code, Léo's trainer code.
  fb.docs.set('users/u2', { nome: 'B' })
  fb.docs.set('users/u2/workouts/x1', { json: '{}' })
  fb.docs.set('vinculos/p9_u2', { personalId: 'p9', alunoId: 'u2', status: 'ativo' })
  fb.docs.set('convitesAluno/OTHER', { personalId: 'p9', ativo: true })
  fb.docs.set('convitesPersonal/LEO-CODE', { ativo: false, usadoPor: 'u1' })
}
beforeEach(() => {
  seed()
  fb.steps.length = 0; fb.batchSizes.length = 0
  fb.failCommit = null; fb.reauthError = null
  fb.user = { uid: 'u1', email: 'u1@x.y' }
})

describe('apagarConta', () => {
  it('reauthenticates, deletes everything of the account in order, and the Auth account last', async () => {
    await apagarConta('secret1')
    expect(fb.steps[0]).toEqual(['reauth', 'u1', { email: 'u1@x.y', senha: 'secret1' }])
    expect([...fb.docs.keys()].sort()).toEqual(['convitesAluno/OTHER', 'convitesPersonal/LEO-CODE', 'users/u2', 'users/u2/workouts/x1', 'vinculos/p9_u2'])
    const deleted = fb.steps.filter(s => s[0] === 'delete').map(s => s[1])
    const at = p => deleted.indexOf(p)
    expect(at('users/u1/workouts/w0')).toBeLessThan(at('vinculos/p9_u1'))
    expect(at('vinculos/u1_a7')).toBeLessThan(at('convitesAluno/CODE-1'))
    expect(deleted.at(-1)).toBe('users/u1')
    expect(fb.steps.at(-1)).toEqual(['deleteUser', 'u1'])
  })
  it('deletes the history in batches of at most 500', async () => {
    await apagarConta('secret1')
    expect(Math.max(...fb.batchSizes)).toBeLessThanOrEqual(500)
    expect(fb.batchSizes.slice(0, 3)).toEqual([500, 500, 203])
  })
  it('a wrong password deletes nothing, and says "wrong password"', async () => {
    fb.reauthError = Object.assign(new Error('x'), { code: 'auth/invalid-credential' })
    const before = fb.docs.size
    const e = await apagarConta('nope').catch(x => x)
    expect(e.code).toBe('auth/invalid-credential')
    expect(fb.docs.size).toBe(before)
    expect(fb.steps.some(s => s[0] === 'delete' || s[0] === 'deleteUser')).toBe(false)
    expect(dayonDeleteMessage(e)).toBe('Wrong password. Try again.')
  })
  it('a Firestore step that fails keeps the Auth account, and trying again finishes the job', async () => {
    fb.failCommit = 'vinculos/'
    await expect(apagarConta('secret1')).rejects.toMatchObject({ code: 'unavailable' })
    expect(fb.steps.some(s => s[0] === 'deleteUser')).toBe(false)
    expect(fb.docs.has('users/u1')).toBe(true)
    fb.failCommit = null
    await apagarConta('secret1')
    expect(fb.docs.has('users/u1')).toBe(false)
    expect(fb.docs.has('vinculos/p9_u1')).toBe(false)
    expect(fb.steps.at(-1)).toEqual(['deleteUser', 'u1'])
  })
  it('without a password, signed out or offline: nothing is asked of Firebase', async () => {
    await expect(apagarConta('')).rejects.toMatchObject({ code: 'auth/missing-password' })
    fb.user = null
    await expect(apagarConta('secret1')).rejects.toMatchObject({ code: 'dayon/signed-out' })
    fb.user = { uid: 'u1', email: 'u1@x.y' }
    vi.stubGlobal('navigator', { onLine: false })
    const e = await apagarConta('secret1').catch(x => x)
    vi.unstubAllGlobals()
    expect(e.code).toBe('dayon/offline')
    expect(fb.steps).toEqual([])
  })
  it('the messages: too many tries and no connection', () => {
    expect(dayonDeleteMessage({ code: 'auth/too-many-requests' })).toBe('Too many tries. Wait a moment and try again.')
    expect(dayonDeleteMessage({ code: 'auth/network-request-failed' })).toBe('No connection. Check the internet and try again.')
    expect(dayonDeleteMessage({ code: 'dayon/offline' })).toBe('No connection. Check the internet and try again.')
  })
})
