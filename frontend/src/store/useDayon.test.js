// @vitest-environment happy-dom
// DAYON - Treino: the Dayon account's store (store/useDayon.js). Without an account nothing calls
// Firebase; a device signed in to its own server leaves the Dayon cloud paused.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  lerNuvem: vi.fn(async () => ({ plan: null, estado: null, workouts: [], since: null })),
  gravarNuvem: vi.fn(async () => {}),
  watchAuth: vi.fn(async () => () => {}),
  lerPerfil: vi.fn(async () => null),
  sair: vi.fn(async () => {}),
  criarConta: vi.fn(async () => ({ user: { uid: 'u1', email: 'a@b.c', displayName: '' }, perfil: null })),
  entrar: vi.fn(async () => ({ user: { uid: 'u1', email: 'a@b.c', displayName: '' }, perfil: null })),
}))
vi.mock('../lib/dayon-cloud.js', () => cloud)

const { useStore } = await import('./useStore.js')
const { useDayon } = await import('./useDayon.js')

beforeEach(() => {
  localStorage.clear()
  for (const f of Object.values(cloud)) f.mockClear()
  useStore.setState({ user: null, ready: true })
})
afterEach(() => {
  vi.useRealTimers()
  useDayon.setState({ user: null, perfil: null, choice: false, status: 'off', listening: false, error: null })
})

describe('useDayon', () => {
  it('without a Firebase config, start() loads nothing', async () => {
    useDayon.setState({ available: false })
    await useDayon.getState().start()
    expect(useDayon.getState().authReady).toBe(true)
    expect(cloud.watchAuth).not.toHaveBeenCalled()
  })
  it('signed in, a device paired with its own server does not sync to Dayon', async () => {
    useStore.setState({ user: { id: 'srv', name: 'S' } })
    useDayon.setState({ user: { uid: 'u1', email: 'a@b.c' } })
    await useDayon.getState().syncNow()
    expect(useDayon.getState().status).toBe('paused')
    expect(cloud.lerNuvem).not.toHaveBeenCalled()
  })
  it('signed in in local mode: reads, merges and sends the first copy', async () => {
    useStore.getState().replaceState({ ...useStore.getState().S, routines: [{ id: 'r1', name: 'A', items: [] }] }, false)
    useDayon.setState({ user: { uid: 'u1', email: 'a@b.c' } })
    await useDayon.getState().syncNow()
    expect(cloud.lerNuvem).toHaveBeenCalledWith('u1', null)
    expect(cloud.gravarNuvem).toHaveBeenCalledTimes(1)
    const [uid, writes] = cloud.gravarNuvem.mock.calls[0]
    expect(uid).toBe('u1')
    expect(JSON.parse(writes.plan.json).routines[0].id).toBe('r1')
    expect(useDayon.getState().status).toBe('ok')
    expect(localStorage.getItem('dayon_owner')).toBe('u1')
  })
  it('no network: offline, nothing lost, tried again later', async () => {
    cloud.lerNuvem.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }))
    const before = JSON.stringify(useStore.getState().S)
    useDayon.setState({ user: { uid: 'u1', email: 'a@b.c' } })
    await useDayon.getState().syncNow()
    expect(useDayon.getState().status).toBe('offline')
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
  })
  it('signing out keeps this device’s copy', async () => {
    useStore.getState().replaceState({ ...useStore.getState().S, routines: [{ id: 'r9', name: 'B', items: [] }] }, false)
    useDayon.setState({ user: { uid: 'u1', email: 'a@b.c' } })
    await useDayon.getState().signOut()
    expect(cloud.sair).toHaveBeenCalled()
    expect(useDayon.getState().user).toBeNull()
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['r9'])
  })
  it('after creating an account, the name and student role show at once even if the profile read races ahead', async () => {
    vi.useFakeTimers()
    let authCb = null
    let finishRead
    const pendingRead = new Promise(r => { finishRead = r })
    cloud.watchAuth.mockImplementation(async cb => { authCb = cb; return () => {} })
    cloud.lerPerfil.mockImplementation(() => pendingRead)
    cloud.criarConta.mockImplementation(async ({ nome, email }) => {
      await authCb({ uid: 'u2', email, displayName: '' })
      return { user: { uid: 'u2', email, displayName: nome }, perfil: { nome, papel: 'aluno', email } }
    })
    await useDayon.getState().listen()
    await useDayon.getState().signUp({ nome: 'Maria Silva', email: 'maria@teste.com', senha: 'secret1' })
    const afterSignUp = useDayon.getState()
    expect(afterSignUp.user.nome).toBe('Maria Silva')
    expect(afterSignUp.perfil).toEqual({ nome: 'Maria Silva', papel: 'aluno', email: 'maria@teste.com' })
    finishRead(null)
    await pendingRead
    await Promise.resolve()
    await Promise.resolve()
    const afterLateRead = useDayon.getState()
    expect(afterLateRead.user.nome).toBe('Maria Silva')
    expect(afterLateRead.perfil?.nome).toBe('Maria Silva')
    expect(afterLateRead.perfil?.papel).toBe('aluno')
  })
})
