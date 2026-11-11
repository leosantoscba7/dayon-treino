// @vitest-environment happy-dom
// DAYON - Treino, etapa 3: a trainer edits a student's plan on the app's own plan screens. The
// store shows a stand-in copy meanwhile; the trainer's own plan and history on this device stay as
// they were, nothing of the copy is saved here or synced to the trainer's Dayon account, and only
// the student's plan document is written (store/useTrainer.js, lib/dayon-trainer.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  lerNuvem: vi.fn(async () => ({ plan: null, estado: null, workouts: [], since: null })),
  gravarNuvem: vi.fn(async () => {}),
  watchAuth: vi.fn(async () => () => {}),
  lerPerfil: vi.fn(async () => null),
  sair: vi.fn(async () => {}),
  lerPlanoAluno: vi.fn(),
  gravarPlanoAluno: vi.fn(async () => {}),
}))
vi.mock('../lib/dayon-cloud.js', () => cloud)
vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ rev: 1 })) }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

const { useStore, DEF } = await import('./useStore.js')
const { useDayon } = await import('./useDayon.js')
const { useTrainer } = await import('./useTrainer.js')

const clone = v => JSON.parse(JSON.stringify(v))
const studentPlan = { unit: 'kg', routines: [{ id: 's1', name: 'Student A', emoji: 'dumbbell', ex: [] }], week: { 2: 's1' }, _ts: 10 }

beforeEach(() => {
  localStorage.clear()
  for (const f of Object.values(cloud)) f.mockClear()
  toast.mockClear()
  cloud.lerPlanoAluno.mockImplementation(async () => ({ plan: clone(studentPlan) }))
  useStore.setState({ S: clone(DEF), user: null, ready: true })
  useStore.getState().update(s => {
    s.routines = [{ id: 't1', name: 'Trainer own', emoji: 'dumbbell', ex: [] }]
    s.week = { 1: 't1' }
    s.workouts = [{ id: 'tw', d: '2026-11-01', entries: [] }]
  }, false)
})
afterEach(() => {
  useTrainer.getState().discard()
  useDayon.setState({ user: null, choice: false, status: 'off' })
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('a trainer editing a student\'s plan', () => {
  it('shows the student\'s plan, and leaving gives the trainer\'s copy back untouched', async () => {
    const real = useStore.getState().S
    const saved = localStorage.getItem('gym_state_v1')
    expect(await useTrainer.getState().open({ alunoId: 'a1', nome: 'Bia' })).toBe(true)
    expect(cloud.lerPlanoAluno).toHaveBeenCalledWith('a1')
    expect(useStore.getState().tourSandbox).toBe(true)
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['s1'])
    expect(useStore.getState().S.workouts).toEqual([])
    // the plan screens edit it like any plan
    useStore.getState().update(s => { s.routines[0].name = 'Renamed by trainer' })
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    useTrainer.getState().discard()
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S).toBe(real)
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Trainer own'])
    expect(cloud.gravarPlanoAluno).not.toHaveBeenCalled()
  })

  it('Save writes only the student\'s plan document, then hands the trainer\'s copy back', async () => {
    const saved = localStorage.getItem('gym_state_v1')
    await useTrainer.getState().open({ alunoId: 'a1', nome: 'Bia' })
    useStore.getState().update(s => { s.routines.push({ id: 's2', name: 'Student B', emoji: 'dumbbell', ex: [] }) })
    expect(useTrainer.getState().dirty()).toBe(true)
    const r = await useTrainer.getState().save()
    expect(r.saved).toBe(true)
    expect(cloud.gravarPlanoAluno).toHaveBeenCalledTimes(1)
    const [alunoId, json, expectHash] = cloud.gravarPlanoAluno.mock.calls[0]
    expect(alunoId).toBe('a1')
    expect(expectHash).toBeTruthy()
    const doc = JSON.parse(json)
    expect(doc.routines.map(x => x.id)).toEqual(['s1', 's2'])
    expect(doc).not.toHaveProperty('workouts')
    expect(JSON.stringify(doc)).not.toContain('Trainer own')
    // the trainer's own copy, here and saved, as it was
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S.routines.map(x => x.id)).toEqual(['t1'])
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['tw'])
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    // the student's own data is never written
    expect(cloud.gravarNuvem).not.toHaveBeenCalled()
  })

  it('Save with nothing changed writes nothing', async () => {
    await useTrainer.getState().open({ alunoId: 'a1', nome: 'Bia' })
    expect(useTrainer.getState().dirty()).toBe(false)
    expect((await useTrainer.getState().save()).saved).toBe(false)
    expect(cloud.gravarPlanoAluno).not.toHaveBeenCalled()
    expect(useStore.getState().tourSandbox).toBe(false)
  })

  it('a refused save keeps the edit on screen to try again', async () => {
    await useTrainer.getState().open({ alunoId: 'a1', nome: 'Bia' })
    useStore.getState().update(s => { s.routines[0].name = 'X' })
    cloud.gravarPlanoAluno.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }))
    await expect(useTrainer.getState().save()).rejects.toMatchObject({ code: 'unavailable' })
    expect(useTrainer.getState().editing).toBeTruthy()
    expect(useStore.getState().S.routines[0].name).toBe('X')
  })

  it('the trainer\'s own Dayon sync never sends the student\'s copy into the trainer\'s account', async () => {
    useDayon.setState({ user: { uid: 'trainer-1', email: 't@d.c' }, status: 'ok' })
    await useTrainer.getState().open({ alunoId: 'a1', nome: 'Bia' })
    useStore.getState().update(s => { s.routines[0].name = 'Edited' })
    await useDayon.getState().syncNow()
    expect(cloud.lerNuvem).not.toHaveBeenCalled()
    expect(cloud.gravarNuvem).not.toHaveBeenCalled()
    useTrainer.getState().discard()
    // back on the real copy, the sync runs again, with the trainer's own plan
    await useDayon.getState().syncNow()
    expect(cloud.lerNuvem).toHaveBeenCalledWith('trainer-1', null)
    const sent = cloud.gravarNuvem.mock.calls.map(c => c[1].plan?.json).filter(Boolean).join('')
    expect(sent).not.toContain('Edited')
  })
})

describe('the student\'s side', () => {
  it('a plan the trainer wrote is merged in and said in a short toast', async () => {
    useDayon.setState({ user: { uid: 'u1', email: 'a@b.c' }, status: 'ok' })
    cloud.lerNuvem.mockResolvedValueOnce({
      plan: { unit: 'kg', routines: [{ id: 'p1', name: 'From trainer', ex: [], _ts: Date.now() + 5000 }], _ts: Date.now() + 5000 },
      planPor: 'trainer-1', estado: null, workouts: [], since: null,
    })
    await useDayon.getState().syncNow()
    expect(useStore.getState().S.routines.map(r => r.id)).toContain('p1')
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Plan updated by your trainer'))
    toast.mockClear()
    // the next sync, with the same plan, says nothing
    await useDayon.getState().syncNow()
    await new Promise(r => setTimeout(r, 0))
    expect(toast).not.toHaveBeenCalled()
  })
})
