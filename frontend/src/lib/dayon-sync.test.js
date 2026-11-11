import { describe, expect, it } from 'vitest'
import { syncOnce, loadMeta, owesCloud, planFromOther } from './dayon-sync.js'
import { readDoc, hashOf, splitState } from './dayon-model.js'
import { studentCopy, planPart } from './dayon-trainer.js'
import { stampDeletions, stampEdits, stampChange } from './sync-merge.js'

// An in-memory stand-in for Firestore with the same contract as lib/dayon-cloud.js.
function fakeCloud() {
  let clock = 1000
  const db = { plan: null, estado: null, workouts: new Map() }
  const hashDoc = d => { const c = d && readDoc(d); return c ? hashOf(c) : null }
  const cloud = {
    db, reads: 0, writes: 0, beforeWrite: null,
    async read(uid, since) {
      cloud.reads++
      const ws = [...db.workouts.entries()].filter(([, d]) => !since || d.at > since)
      return {
        plan: readDoc(db.plan), planPor: db.plan?.por || null, estado: readDoc(db.estado),
        workouts: ws.map(([id, d]) => ({ id, w: readDoc(d) })),
        since: ws.reduce((m, [, d]) => Math.max(m, d.at), since || 0) || null,
      }
    },
    async write(uid, writes, { expectPlan, expectEstado }) {
      if (cloud.beforeWrite) { const f = cloud.beforeWrite; cloud.beforeWrite = null; f() }
      if (writes.plan || writes.estado) {
        if (hashDoc(db.plan) !== expectPlan || hashDoc(db.estado) !== expectEstado) throw Object.assign(new Error('conflict'), { code: 'dayon/conflict' })
        if (writes.plan) db.plan = { json: writes.plan.json, at: ++clock, por: uid }
        if (writes.estado) db.estado = { json: writes.estado.json, at: ++clock }
      }
      for (const u of writes.upserts) db.workouts.set(u.id, { json: u.json, at: ++clock })
      for (const id of writes.deletes) db.workouts.delete(id)
      cloud.writes++
    },
  }
  return cloud
}
function memStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
// One device: its copy, its storage, and an edit helper that stamps like the store's update().
function device(S) {
  const d = { S, storage: memStorage(), applied: 0 }
  d.edit = fn => {
    const next = JSON.parse(JSON.stringify(d.S))
    fn(next)
    next._ts = Math.max(Date.now(), (d.S._ts || 0) + 1)
    stampEdits(d.S, next, next._ts)
    stampDeletions(d.S, next, next._ts)
    d.S = next
  }
  d.sync = cloud => syncOnce({ uid: 'u1', cloud, storage: d.storage, getState: () => d.S, applyState: S => { d.S = S; d.applied++ } })
  return d
}
const wk = (id, d) => ({ id, d, start: id, entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }], _ts: id })
const profile = () => ({
  unit: 'kg', restSec: 90, _ts: 100, week: { 1: 'r1' }, dayPlan: {}, exWeights: {},
  routines: [{ id: 'r1', name: 'A', items: [{ id: '0025' }], _ts: 50 }],
  bodyweight: [], workouts: [wk(1, '2026-11-01')], active: null,
})

describe('syncOnce', () => {
  it('first sync sends everything; the next one sends nothing', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    const r = await phone.sync(cloud)
    expect(r.wrote).toBe(true)
    expect(cloud.db.workouts.size).toBe(1)
    expect(readDoc(cloud.db.plan).routines).toHaveLength(1)
    expect(owesCloud(phone.S, phone.storage, 'u1')).toBe(false)
    const again = await phone.sync(cloud)
    expect(again.wrote).toBe(false)
  })

  it('a workout logged on the phone reaches the website, and the website’s reaches the phone', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    await phone.sync(cloud)
    const site = device({ ...profile(), workouts: [] })
    await site.sync(cloud)
    expect(site.S.workouts.map(w => w.id)).toEqual([1])
    phone.edit(s => { s.workouts.push(wk(2, '2026-11-03')) })
    await phone.sync(cloud)
    site.edit(s => { s.restSec = 120 })
    await site.sync(cloud)
    expect(site.S.workouts.map(w => w.id).sort()).toEqual([1, 2])
    await phone.sync(cloud)
    expect(phone.S.restSec).toBe(120)
  })

  it('later syncs read only the workouts written since', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    await phone.sync(cloud)
    // the first read came before its own writes; the second one reads them back once
    await phone.sync(cloud)
    const since = loadMeta(phone.storage, 'u1').since
    expect(since).toBeGreaterThan(0)
    const read = await cloud.read('u1', since)
    expect(read.workouts).toEqual([])
  })

  it('a trainer’s plan change made during the sync is merged, not written over', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    await phone.sync(cloud)
    phone.edit(s => { s.restSec = 60 })
    phone.edit(s => { s.week = { ...s.week, 5: 'r1' } })
    // the trainer saves the plan (another day of the week) just before the phone writes
    cloud.beforeWrite = () => {
      const plan = readDoc(cloud.db.plan)
      plan.week = { ...plan.week, 3: 'r1' }
      plan.edited = { ...(plan.edited || {}), 'week.3': Date.now() + 5000 }
      cloud.db.plan = { json: JSON.stringify(plan), at: 5000 }
    }
    await phone.sync(cloud)
    const plan = readDoc(cloud.db.plan)
    expect(plan.week[3]).toBe('r1')
    expect(plan.week[5]).toBe('r1')
    expect(phone.S.week[3]).toBe('r1')
    expect(readDoc(cloud.db.estado).restSec).toBe(60)
  })

  it('a workout deleted on one device is deleted in the cloud and on the other device', async () => {
    const cloud = fakeCloud()
    const phone = device({ ...profile(), workouts: [wk(1, '2026-11-01'), wk(2, '2026-11-02')] })
    await phone.sync(cloud)
    const site = device({ ...profile(), workouts: [] })
    await site.sync(cloud)
    site.edit(s => { s.workouts = s.workouts.filter(w => w.id !== 2) })
    await site.sync(cloud)
    expect([...cloud.db.workouts.keys()]).toEqual(['1'])
    await phone.sync(cloud)
    expect(phone.S.workouts.map(w => w.id)).toEqual([1])
  })

  it('offline: nothing is lost here and the next sync sends it', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    await phone.sync(cloud)
    phone.edit(s => { s.workouts.push(wk(3, '2026-11-04')) })
    const real = cloud.read
    cloud.read = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }) }
    await expect(phone.sync(cloud)).rejects.toMatchObject({ code: 'unavailable' })
    expect(phone.S.workouts.map(w => w.id)).toEqual([1, 3])
    expect(owesCloud(phone.S, phone.storage, 'u1')).toBe(true)
    cloud.read = real
    await phone.sync(cloud)
    expect(cloud.db.workouts.has('3')).toBe(true)
  })

  it('the running workout on this device is never touched by the cloud', async () => {
    const cloud = fakeCloud()
    const site = device({ ...profile(), active: null })
    await site.sync(cloud)
    site.edit(s => { s.restSec = 75 })
    await site.sync(cloud)
    const phone = device({ ...profile(), workouts: [], active: { started: 42, entries: [] } })
    await phone.sync(cloud)
    expect(phone.S.active).toEqual({ started: 42, entries: [] })
    expect(phone.S.restSec).toBe(75)
    expect(splitState(phone.S).plan.active).toBeUndefined()
  })
})

// DAYON - Treino, etapa 3: a trainer saved the student's plan (lib/dayon-trainer.js savePlan, `por`
// the trainer's uid). The student's next sync takes it in by the usual merge and says so once.
describe('plan updated by the trainer', () => {
  // The trainer's save, as gravarPlanoAluno writes it: only the plan document, `por` the trainer.
  const trainerSaves = (cloud, edit) => {
    const S = studentCopy({ unit: 'kg', lang: 'pt' }, readDoc(cloud.db.plan), {})
    const next = JSON.parse(JSON.stringify(S))
    edit(next)
    next._ts = stampChange(S, next, Date.now() + 1000)
    cloud.db.plan = { json: JSON.stringify(planPart(next)), at: 5000, por: 'trainer-1' }
  }

  it('the student\'s sync takes the trainer\'s routine and reports who changed the plan', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    await phone.sync(cloud)
    trainerSaves(cloud, s => { s.routines.push({ id: 'r2', name: 'Trainer B', items: [] }) })
    const r = await phone.sync(cloud)
    expect(r.planBy).toBe('trainer-1')
    expect(phone.S.routines.map(x => x.id)).toEqual(['r1', 'r2'])
  })

  it('says nothing on the syncs after it, nor for the student\'s own plan changes', async () => {
    const cloud = fakeCloud()
    const phone = device(profile())
    await phone.sync(cloud)
    trainerSaves(cloud, s => { s.week = { ...s.week, 3: 'r1' } })
    expect((await phone.sync(cloud)).planBy).toBe('trainer-1')
    expect((await phone.sync(cloud)).planBy).toBeNull()
    phone.edit(s => { s.routines[0].name = 'Mine now' })
    expect((await phone.sync(cloud)).planBy).toBeNull()
    // another of the student's own devices changing the plan is not the trainer
    const site = device({ ...profile(), workouts: [] })
    await site.sync(cloud)
    site.edit(s => { s.week = { ...s.week, 4: 'r1' } })
    await site.sync(cloud)
    expect((await phone.sync(cloud)).planBy).toBeNull()
  })

  it('planFromOther: a plan the trainer wrote that changed nothing here is not news', () => {
    const plan = { routines: [] }
    const S = { routines: [] }
    expect(planFromOther({ uid: 'u1', read: { plan, planPor: 't1' }, knownPlan: null, before: S, after: S })).toBeNull()
    expect(planFromOther({ uid: 'u1', read: { plan, planPor: 'u1' }, knownPlan: null, before: S, after: { routines: [{ id: 'x' }] } })).toBeNull()
    expect(planFromOther({ uid: 'u1', read: { plan, planPor: 't1' }, knownPlan: hashOf(plan), before: S, after: { routines: [{ id: 'x' }] } })).toBeNull()
    expect(planFromOther({ uid: 'u1', read: { plan, planPor: 't1' }, knownPlan: null, before: S, after: { routines: [{ id: 'x' }] } })).toBe('t1')
  })
})
