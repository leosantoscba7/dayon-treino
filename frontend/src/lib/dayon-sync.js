// DAYON - Treino: one sync with the Dayon cloud, start to end (docs/dayon/PAINEL.md).
//
//   read   the plan, the rest, and the workouts written since the last read (lib/dayon-cloud.js)
//   merge  this device's copy with them, by the app's own field stamps (lib/dayon-model.js
//          mergeCloud → lib/sync-merge.js mergeStates), and take the result on this device
//   write  what differs from what the cloud holds (planWrites): the plan and the rest in one
//          transaction that fails if a trainer saved the plan in between (then read and merge
//          again), the workouts one document each
//
// Everything it touches comes in as an argument, so the tests drive it against an in-memory
// cloud: `cloud` is { read(uid, since), write(uid, writes, expect) }, `getState()` this
// device's copy, `applyState(S)` takes a merged copy, `storage` keeps what the cloud was last
// known to hold, per account (localStorage in the app).
import { composeCloud, mergeCloud, planWrites, hasWrites, noteRead, emptyMeta, hashOf, splitState } from './dayon-model.js'

const metaKey = uid => 'dayon_sync_' + uid
const ATTEMPTS = 3

export function loadMeta(storage, uid) {
  try {
    const m = JSON.parse(storage.getItem(metaKey(uid)) || 'null')
    if (m && typeof m === 'object' && m.w && typeof m.w === 'object') return m
  } catch { /* unreadable: start over, which costs one full read */ }
  return emptyMeta()
}
export function saveMeta(storage, uid, meta) {
  try { storage.setItem(metaKey(uid), JSON.stringify(meta)) } catch { /* full: the next sync reads everything */ }
}
export function forgetMeta(storage, uid) {
  try { storage.removeItem(metaKey(uid)) } catch { /* nothing to forget */ }
}

/** Whether `S` has anything for the cloud that it does not hold yet (no network involved). */
export function owesCloud(S, storage, uid) {
  return hasWrites(planWrites(S, loadMeta(storage, uid)))
}

/**
 * Whether this sync brought a plan someone else wrote (a trainer): the cloud's plan was written by
 * another account (`planPor`), it is not the one this device last knew (`knownPlan`, its hash),
 * and taking it changed this device's plan. A sync that changed nothing in the plan says nothing.
 */
export function planFromOther({ uid, read, knownPlan, before, after }) {
  if (!read?.plan || !read.planPor || read.planPor === uid) return null
  if (hashOf(read.plan) === knownPlan) return null
  if (hashOf(splitState(before).plan) === hashOf(splitState(after).plan)) return null
  return read.planPor
}

/**
 * One sync. Resolves { applied, wrote, tooBig, planBy } (`planBy`: who else wrote the plan this
 * sync took, see planFromOther; null otherwise) or throws what the cloud threw (offline, refused).
 * `defaults` fills in what an older copy lacks before the merged copy is taken (store DEF).
 */
export async function syncOnce({ uid, cloud, getState, applyState, storage, defaults = {} }) {
  let last = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const meta = loadMeta(storage, uid)
    const knownPlan = meta.plan
    const read = await cloud.read(uid, meta.since)
    noteRead(meta, read)
    // A document gone from the cloud (deleted in the Console) is no longer held there.
    if (!read.plan) meta.plan = null
    if (!read.estado) meta.estado = null
    // This device's copy as it is now, after the read: what changed while it ran is in it.
    const cur = getState()
    const cloudState = composeCloud(cur, read)
    let merged = cur
    let applied = false
    if (cloudState) {
      merged = Object.assign(JSON.parse(JSON.stringify(defaults)), mergeCloud(cur, cloudState))
      if (hashOf({ ...merged, active: null }) !== hashOf({ ...cur, active: null })) { applyState(merged); applied = true }
    }
    const writes = planWrites(merged, meta)
    if (hasWrites(writes)) {
      try {
        await cloud.write(uid, writes, { expectPlan: read.plan ? hashOf(read.plan) : null, expectEstado: read.estado ? hashOf(read.estado) : null })
      } catch (e) {
        last = e
        if (e?.code === 'dayon/conflict') continue
        throw e
      }
      saveMeta(storage, uid, { ...writes.hashes, since: read.since ?? meta.since ?? null })
    } else {
      saveMeta(storage, uid, { ...meta, since: read.since ?? meta.since ?? null })
    }
    const planBy = applied ? planFromOther({ uid, read, knownPlan, before: cur, after: merged }) : null
    return { applied, wrote: hasWrites(writes), tooBig: writes.tooBig, planBy }
  }
  throw last || Object.assign(new Error('dayon/conflict'), { code: 'dayon/conflict' })
}
