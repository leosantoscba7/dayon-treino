import { describe, expect, it } from 'vitest'
import {
  splitState, composeCloud, mergeCloud, planWrites, noteRead, emptyMeta, hasWrites, workoutDocId,
  readDoc, hashOf, MAX_JSON, PLAN_FIELDS,
} from './dayon-model.js'

const w = (id, d, extra = {}) => ({ id, d, start: 1, entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }], _ts: 10, ...extra })
const base = () => ({
  unit: 'kg', restSec: 90, lang: 'pt-BR', _ts: 100,
  routines: [{ id: 'r1', name: 'A', items: [{ id: '0025' }], _ts: 50 }],
  week: { 1: 'r1' }, dayPlan: {}, exWeights: { '0025': { w: 60 } },
  bodyweight: [{ d: '2026-11-01', w: 80, t: 5 }],
  workouts: [w(1, '2026-11-01'), w(2, '2026-11-03')],
  edited: { restSec: 90, 'week.1': 80, routineOrder: 70 },
  deleted: { routines: { r0: 40 }, workouts: { 0: 30 } },
  active: { started: 123 }, coach: { chat: [{ at: 1, text: 'oi' }] },
})

describe('splitState', () => {
  it('puts the plan, the rest and the history in their own documents', () => {
    const { plan, estado, workouts } = splitState(base())
    expect(plan.routines).toHaveLength(1)
    expect(plan.week).toEqual({ 1: 'r1' })
    expect(plan.exWeights).toBeTruthy()
    expect(plan.restSec).toBeUndefined()
    expect(estado.restSec).toBe(90)
    expect(estado.bodyweight).toHaveLength(1)
    expect(estado.routines).toBeUndefined()
    expect(plan.unit).toBe('kg')
    expect(estado.unit).toBe('kg')
    expect(workouts.map(x => x.id)).toEqual(['1', '2'])
    expect(plan.workouts).toBeUndefined()
    expect(estado.workouts).toBeUndefined()
  })
  it('splits the stamps by the field they are about', () => {
    const { plan, estado } = splitState(base())
    expect(plan.edited).toEqual({ 'week.1': 80, routineOrder: 70 })
    expect(estado.edited).toEqual({ restSec: 90 })
    expect(plan.deleted).toEqual({ routines: { r0: 40 } })
    expect(estado.deleted).toEqual({ workouts: { 0: 30 } })
  })
  it('never sends the running workout or the Coach chat', () => {
    const { plan, estado } = splitState(base())
    for (const doc of [plan, estado]) {
      expect(doc.active).toBeUndefined()
      expect(doc.coach).toBeUndefined()
    }
  })
  it('every plan field lands in the plan document', () => {
    const S = Object.fromEntries(PLAN_FIELDS.map(f => [f, { x: 1 }]))
    const { plan, estado } = splitState(S)
    for (const f of PLAN_FIELDS) { expect(plan[f]).toEqual({ x: 1 }); expect(estado[f]).toBeUndefined() }
  })
})

describe('workoutDocId', () => {
  it('uses the workout id, safe as a Firestore document id', () => {
    expect(workoutDocId({ id: 1730000000000 })).toBe('1730000000000')
    expect(workoutDocId({ id: 'a/b' })).toBe('a_b')
    expect(workoutDocId({ d: '2026-11-01', start: 5 })).toBe('2026-11-01|5')
    expect(workoutDocId({ id: '__x__' })).toBe('w__x__')
  })
})

describe('composeCloud', () => {
  it('is null when the cloud holds nothing yet', () => {
    expect(composeCloud(base(), {})).toBeNull()
  })
  it('puts the documents back into one state, with this device’s running workout', () => {
    const S = base()
    const { plan, estado, workouts } = splitState(S)
    const back = composeCloud(S, { plan, estado, workouts })
    expect(back.routines).toEqual(S.routines)
    expect(back.restSec).toBe(90)
    expect(back.workouts).toHaveLength(2)
    expect(back.edited).toEqual(S.edited)
    expect(back.deleted).toEqual(S.deleted)
    expect(back.active).toEqual(S.active)
    expect(back.coach).toEqual(S.coach)
    expect(back._ts).toBe(100)
  })
  it('a missing document stands in with this device’s part', () => {
    const S = base()
    const { plan } = splitState(S)
    const back = composeCloud(S, { plan: { ...plan, week: { 2: 'r1' } } })
    expect(back.week).toEqual({ 2: 'r1' })
    expect(back.restSec).toBe(90)
    expect(back.bodyweight).toEqual(S.bodyweight)
  })
  it('a plan written in another unit is brought into the student’s', () => {
    const S = base()
    const { plan, estado } = splitState(S)
    const lbPlan = { ...plan, unit: 'lb', exWeights: { '0025': { w: 135 } } }
    const back = composeCloud(S, { plan: lbPlan, estado })
    expect(back.unit).toBe('kg')
    expect(back.exWeights['0025'].w).toBeLessThan(70)
    expect(back.exWeights['0025'].w).toBeGreaterThan(55)
  })
})

describe('mergeCloud', () => {
  it('keeps both sides’ workouts and the local running workout', () => {
    const local = base()
    const cloudState = { ...base(), workouts: [w(3, '2026-11-05')], active: null, _ts: 200 }
    const merged = mergeCloud(local, cloudState)
    expect(merged.workouts.map(x => x.id).sort()).toEqual([1, 2, 3])
    expect(merged.active).toEqual(local.active)
  })
  it('a plan day edited later in the cloud wins (stamps, not whole copies)', () => {
    const local = base()
    const cloud = { ...base(), week: { 1: 'r1', 3: 'r1' }, edited: { ...base().edited, 'week.3': 500 }, _ts: 90 }
    const merged = mergeCloud(local, cloud)
    expect(merged.week[3]).toBe('r1')
  })
  it('a workout removed on another device goes here too', () => {
    const local = base()
    const cloud = { ...base(), workouts: [w(1, '2026-11-01')], deleted: { workouts: { 2: 999 } }, _ts: 1000 }
    const merged = mergeCloud(local, cloud)
    expect(merged.workouts.map(x => x.id)).toEqual([1])
  })
})

describe('planWrites', () => {
  it('first sync: everything goes up', () => {
    const p = planWrites(base(), emptyMeta())
    expect(p.plan).toBeTruthy()
    expect(p.estado).toBeTruthy()
    expect(p.upserts.map(x => x.id)).toEqual(['1', '2'])
    expect(p.deletes).toEqual([])
    expect(hasWrites(p)).toBe(true)
  })
  it('nothing changed: nothing to write, even with a new _ts', () => {
    const S = base()
    const { hashes } = planWrites(S, emptyMeta())
    const again = planWrites({ ...S, _ts: 999 }, hashes)
    expect(hasWrites(again)).toBe(false)
  })
  it('keys in another order are the same content', () => {
    const S = base()
    const { hashes } = planWrites(S, emptyMeta())
    const shuffled = Object.fromEntries(Object.entries(S).reverse())
    expect(hasWrites(planWrites(shuffled, hashes))).toBe(false)
  })
  it('only the changed workout and the changed document go up', () => {
    const S = base()
    const { hashes } = planWrites(S, emptyMeta())
    const next = { ...S, restSec: 120, workouts: [S.workouts[0], { ...S.workouts[1], note: 'pesado', _ts: 20 }] }
    const p = planWrites(next, hashes)
    expect(p.plan).toBeNull()
    expect(p.estado).toBeTruthy()
    expect(p.upserts.map(x => x.id)).toEqual(['2'])
  })
  it('a workout removed here (stamped) is deleted in the cloud', () => {
    const S = base()
    const { hashes } = planWrites(S, emptyMeta())
    const p = planWrites({ ...S, workouts: [S.workouts[0]], deleted: { workouts: { 2: 500 } } }, hashes)
    expect(p.deletes).toEqual(['2'])
    expect(p.hashes.w['2']).toBeUndefined()
  })
  it('a reset that wiped the history empties the cloud too', () => {
    const S = base()
    const { hashes } = planWrites(S, emptyMeta())
    const p = planWrites({ ...S, workouts: [], resetAt: 900, resetIds: { workouts: [1, 2] } }, hashes)
    expect(p.deletes.sort()).toEqual(['1', '2'])
  })
  it('a workout this copy merely lacks (no removal on record) stays in the cloud', () => {
    const S = base()
    const { hashes } = planWrites(S, emptyMeta())
    const p = planWrites({ ...S, workouts: [] }, hashes)
    expect(p.deletes).toEqual([])
    expect(p.kept.sort()).toEqual(['1', '2'])
    expect(hasWrites(p)).toBe(false)
  })
  it('a workout only read (never pushed) counts as held by the cloud', () => {
    const S = base()
    const meta = noteRead(emptyMeta(), { workouts: splitState(S).workouts, plan: splitState(S).plan, estado: splitState(S).estado })
    expect(hasWrites(planWrites(S, meta))).toBe(false)
  })
  it('a document over the limit is left out and named, not cut', () => {
    const S = { ...base(), bodyweight: Array.from({ length: 1 }, () => ({ d: 'x', note: 'x'.repeat(MAX_JSON + 10) })) }
    const p = planWrites(S, emptyMeta())
    expect(p.estado).toBeNull()
    expect(p.tooBig).toContain('estado')
    expect(p.plan).toBeTruthy()
  })
  it('two devices meet: the merge of both, written once, is what each then holds', () => {
    // phone wrote first
    const phone = base()
    const first = planWrites(phone, emptyMeta())
    const docs = { plan: JSON.parse(first.plan.json), estado: JSON.parse(first.estado.json), workouts: first.upserts.map(({ id, w }) => ({ id, w })) }
    // the website, with a workout of its own, reads that and merges
    const site = { ...base(), workouts: [w(7, '2026-11-07')], active: null }
    const meta = noteRead(emptyMeta(), docs)
    const merged = mergeCloud(site, composeCloud(site, docs))
    expect(merged.workouts.map(x => x.id).sort()).toEqual([1, 2, 7])
    const p = planWrites(merged, meta)
    expect(p.upserts.map(x => x.id)).toEqual(['7'])
    expect(p.deletes).toEqual([])
  })
})

describe('readDoc', () => {
  it('reads our own documents and ignores anything else', () => {
    expect(readDoc({ json: '{"a":1}' })).toEqual({ a: 1 })
    expect(readDoc({ json: 'not json' })).toBeNull()
    expect(readDoc({ other: 1 })).toBeNull()
    expect(readDoc(null)).toBeNull()
  })
  it('hashOf ignores only the top-level _ts', () => {
    expect(hashOf({ a: 1, _ts: 1 })).toBe(hashOf({ a: 1, _ts: 2 }))
    expect(hashOf({ a: { _ts: 1 } })).not.toBe(hashOf({ a: { _ts: 2 } }))
  })
})
