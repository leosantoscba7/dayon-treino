// DAYON - Treino: redeeming a trainer code (lib/dayon-cloud.js tornarPersonal). Firestore ids are
// case-sensitive: a mixed-case code Léo made in the Console has to be found as typed (QA on the
// test website, 11/11/2026: the code was upper-cased, never found, and "Use" quietly did nothing).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ docs: new Map(), commits: [], commitError: null }))
vi.mock('./dayon-config.js', () => ({ firebaseConfig: () => ({ projectId: 'p' }) }))
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/auth', () => ({ initializeAuth: () => ({ currentUser: { uid: 'u1' } }), indexedDBLocalPersistence: {}, browserLocalPersistence: {} }))
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}),
  doc: (_db, ...path) => ({ path: path.join('/'), id: path[path.length - 1] }),
  getDoc: async ref => {
    const d = db.docs.get(ref.path)
    return { exists: () => !!d, data: () => d }
  },
  serverTimestamp: () => 'SERVER_TS',
  writeBatch: () => {
    const ops = []
    return {
      update: (ref, data) => ops.push({ path: ref.path, data }),
      commit: async () => {
        if (db.commitError) throw db.commitError
        db.commits.push(ops)
        for (const o of ops) db.docs.set(o.path, { ...db.docs.get(o.path), ...o.data })
      },
    }
  },
}))

const { tornarPersonal, limparCodigoPersonal } = await import('./dayon-cloud.js')
const { dayonMessage } = await import('./dayon-errors.js')

const CODE = 'Ab3x-Kq_9zPw-LmN8-Rt5y-Vu' // mixed case, like the one in the Console
beforeEach(() => {
  db.docs.clear(); db.commits.length = 0; db.commitError = null
  db.docs.set('users/u1', { nome: 'P', papel: 'aluno', email: 'p@x.y' })
  db.docs.set(`convitesPersonal/${CODE}`, { ativo: true, usadoPor: null, usadoEm: null })
})

describe('tornarPersonal', () => {
  it('finds a mixed-case code as typed, with stray spaces and a line break from a paste', async () => {
    await tornarPersonal('u1', `  ${CODE}\n`)
    expect(db.commits).toHaveLength(1)
    expect(db.commits[0]).toEqual([
      { path: `convitesPersonal/${CODE}`, data: { ativo: false, usadoPor: 'u1', usadoEm: 'SERVER_TS' } },
      { path: 'users/u1', data: { papel: 'personal', conviteUsado: CODE, atualizadoEm: 'SERVER_TS' } },
    ])
  })
  it('a keyboard that capitalised a code made in capitals still finds it', async () => {
    db.docs.set('convitesPersonal/ABCD-EFGH-JKMN', { ativo: true, usadoPor: null, usadoEm: null })
    await tornarPersonal('u1', 'abcd-efgh-jkmn')
    expect(db.commits[0][1].data.conviteUsado).toBe('ABCD-EFGH-JKMN')
  })
  it('does not capitalise a mixed-case code', () => {
    expect(limparCodigoPersonal(` ${CODE} `)).toBe(CODE)
  })
  it('an unknown or used code: "invalid or already used", nothing written', async () => {
    await expect(tornarPersonal('u1', 'NOPE')).rejects.toMatchObject({ code: 'dayon/invalid-code' })
    db.docs.set(`convitesPersonal/${CODE}`, { ativo: false, usadoPor: 'x', usadoEm: 'T' })
    await expect(tornarPersonal('u1', CODE)).rejects.toMatchObject({ code: 'dayon/invalid-code' })
    expect(db.commits).toHaveLength(0)
  })
  it('already a trainer: says so', async () => {
    db.docs.set('users/u1', { papel: 'personal' })
    await expect(tornarPersonal('u1', CODE)).rejects.toMatchObject({ code: 'dayon/already-trainer' })
  })
  it('the rules refuse a code that is still free: the refusal, not "invalid code"', async () => {
    db.commitError = Object.assign(new Error('denied'), { code: 'permission-denied' })
    const e = await tornarPersonal('u1', CODE).catch(x => x)
    expect(e.code).toBe('permission-denied')
    expect(dayonMessage(e)).not.toBe(dayonMessage({ code: 'dayon/invalid-code' }))
  })
  it('offline: the network error, not "invalid code"', async () => {
    db.commitError = Object.assign(new Error('x'), { code: 'unavailable' })
    await expect(tornarPersonal('u1', CODE)).rejects.toMatchObject({ code: 'unavailable' })
  })
})
