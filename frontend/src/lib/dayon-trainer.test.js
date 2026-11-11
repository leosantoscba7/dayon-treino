import { describe, expect, it, vi } from 'vitest'
import { studentCopy, planPart, planChanged, savePlan, studentRows, readNames, rememberNames } from './dayon-trainer.js'
import { hashOf, readDoc } from './dayon-model.js'
import { stampChange } from './sync-merge.js'

// The trainer's own copy: their settings, their plan, their history.
const trainer = () => ({
  unit: 'kg', lang: 'pt-BR', theme: 'light', accent: 'lime', restSec: 120,
  routines: [{ id: 't1', name: 'Mine', emoji: 'dumbbell', ex: [] }], week: { 1: 't1' }, dayPlan: {},
  workouts: [{ id: 'tw1', d: '2026-11-01', entries: [] }], bodyweight: [{ d: '2026-11-01', w: 80 }],
  edited: { 'settings.restSec': 5 }, active: { id: 'run' }, _ts: 50,
})
// The student's plan document, as lib/dayon-model.js splitState writes it.
const studentPlan = () => ({
  unit: 'lb', routines: [{ id: 's1', name: 'Hers', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
  week: { 2: 's1' }, exWeights: { '0025': 95 }, edited: { 'week.2': 40 }, _ts: 40,
})
const DEF = { unit: 'kg', routines: [], week: {}, dayPlan: {}, customEx: [] }
// An edit the way the store's update() stamps one.
const edit = (S, fn) => {
  const next = JSON.parse(JSON.stringify(S))
  fn(next)
  next._ts = stampChange(S, next, Date.now())
  return next
}

describe('studentCopy', () => {
  it('swaps in the student\'s plan, keeps the trainer\'s look, carries no workouts', () => {
    const real = trainer()
    const before = JSON.stringify(real)
    const S = studentCopy(real, studentPlan(), DEF)
    expect(JSON.stringify(real)).toBe(before)
    expect(S.routines.map(r => r.id)).toEqual(['s1'])
    expect(S.week).toEqual({ 2: 's1' })
    expect(S.exWeights).toEqual({ '0025': 95 })
    expect(S.unit).toBe('lb')
    expect(S.lang).toBe('pt-BR')
    expect(S.theme).toBe('light')
    expect(S.workouts).toEqual([])
    expect(S.active).toBeNull()
    expect(S.edited).toEqual({ 'week.2': 40 })
  })
  it('a student with no plan yet starts from an empty one, not from the trainer\'s', () => {
    const S = studentCopy(trainer(), null, DEF)
    expect(S.routines).toEqual([])
    expect(S.week).toEqual({})
  })
  it('the plan part holds only the plan: no history, no weigh-ins, no trainer settings', () => {
    const p = planPart(studentCopy(trainer(), studentPlan(), DEF))
    expect(p.routines.map(r => r.id)).toEqual(['s1'])
    expect(p).not.toHaveProperty('workouts')
    expect(p).not.toHaveProperty('bodyweight')
    expect(p).not.toHaveProperty('lang')
    expect(p).not.toHaveProperty('restSec')
    expect(Object.keys(p.edited || {})).toEqual(['week.2'])
  })
  it('planChanged sees an edit and ignores a copy that is the same', () => {
    const start = studentCopy(trainer(), studentPlan(), DEF)
    expect(planChanged(start, JSON.parse(JSON.stringify(start)))).toBe(false)
    expect(planChanged(start, edit(start, s => { s.routines[0].name = 'Renamed' }))).toBe(true)
    // a setting is not the plan
    expect(planChanged(start, edit(start, s => { s.restSec = 30 }))).toBe(false)
  })
})

// A plan document in memory with the same contract as lib/dayon-cloud.js.
function planCloud(initial) {
  const c = {
    doc: initial ? JSON.stringify(initial) : null,
    writes: [],
    async readPlan() { return { plan: c.doc ? readDoc({ json: c.doc }) : null } },
    async writePlan(alunoId, json, expect) {
      const now = c.doc ? hashOf(readDoc({ json: c.doc })) : null
      if (now !== expect) throw Object.assign(new Error('conflict'), { code: 'dayon/conflict' })
      c.doc = json
      c.writes.push({ alunoId, json })
    },
  }
  return c
}

describe('savePlan', () => {
  it('writes the plan for the student, and only the plan', async () => {
    const base = studentPlan()
    const cloud = planCloud(base)
    const start = studentCopy(trainer(), base, DEF)
    const edited = edit(start, s => { s.routines[0].name = 'Push A' })
    const r = await savePlan({ alunoId: 'a1', edited, basePlan: base, cloud })
    expect(r.merged).toBe(false)
    expect(cloud.writes).toHaveLength(1)
    expect(cloud.writes[0].alunoId).toBe('a1')
    const doc = JSON.parse(cloud.doc)
    expect(doc.routines[0].name).toBe('Push A')
    expect(doc).not.toHaveProperty('workouts')
    expect(doc).not.toHaveProperty('lang')
  })
  it('the student saved in between: their change and the trainer\'s are both kept', async () => {
    const base = studentPlan()
    const cloud = planCloud(base)
    // The student renames the routine, saved first.
    const studentS = edit({ ...DEF, ...base }, s => { s.routines[0].name = 'Student name' })
    cloud.doc = JSON.stringify(planPart(studentS))
    // The trainer, from the old plan, sets a routine on Friday.
    const start = studentCopy(trainer(), base, DEF)
    const edited = edit(start, s => { s.week = { ...s.week, 5: 's1' } })
    const r = await savePlan({ alunoId: 'a1', edited, basePlan: base, cloud })
    expect(r.merged).toBe(true)
    const doc = JSON.parse(cloud.doc)
    expect(doc.routines[0].name).toBe('Student name')
    expect(doc.week[5]).toBe('s1')
  })
  it('a refusal is thrown, not retried', async () => {
    const cloud = { readPlan: vi.fn(), writePlan: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }) }) }
    await expect(savePlan({ alunoId: 'a1', edited: studentCopy(trainer(), null, DEF), cloud })).rejects.toMatchObject({ code: 'permission-denied' })
    expect(cloud.writePlan).toHaveBeenCalledTimes(1)
    expect(cloud.readPlan).not.toHaveBeenCalled()
  })
})

describe('studentRows', () => {
  it('active students first, by name, with their last workout', () => {
    const rows = studentRows([
      { alunoId: 'c', status: 'encerrado' },
      { alunoId: 'b', status: 'ativo' },
      { alunoId: 'a', status: 'ativo' },
    ], { a: 'Zé', b: 'Ana', c: 'Caio' }, { a: '2026-11-02', b: null })
    expect(rows.map(r => r.alunoId)).toEqual(['b', 'a', 'c'])
    expect(rows[1]).toMatchObject({ nome: 'Zé', status: 'ativo', ultimo: '2026-11-02' })
    expect(rows[2]).toMatchObject({ nome: 'Caio', status: 'encerrado', ultimo: null })
  })
  it('names seen once are kept on the device for a link that ended', () => {
    const m = new Map()
    const storage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
    rememberNames(storage, { a: 'Ana', b: null })
    expect(readNames(storage)).toEqual({ a: 'Ana' })
    rememberNames(storage, { c: 'Caio' })
    expect(readNames(storage)).toEqual({ a: 'Ana', c: 'Caio' })
  })
})
