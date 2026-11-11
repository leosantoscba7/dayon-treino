/* DAYON - Treino: the account state as Firestore documents (docs/dayon/PAINEL.md).
 *
 * One state (store/useStore.js `S`) becomes three kinds of documents under users/{uid}:
 *
 *   plan/atual       the plan: routines, week, dayPlan, rotation, programmes, custom exercises and
 *                    the per-exercise loads and settings a workout is built from. The student and
 *                    a trainer with an active link both read and write it.
 *   estado/atual     everything else that syncs (settings, weigh-ins, measurements, notes...):
 *                    the student only.
 *   workouts/{id}    one document per logged workout, by the workout's own id: a Firestore
 *                    document holds at most 1 MiB, a whole history does not fit in one.
 *
 * Each document carries its content as JSON text (`json`): no nested-array or `undefined`
 * restrictions, and the size check is the text's length. The merge is the one the app already
 * runs between two devices (lib/sync-merge.js mergeStates): the documents are put back together
 * into a copy of the state (composeCloud), merged with this device's, and what differs from what
 * the cloud last held is written back (planWrites). Nothing here talks to Firebase
 * (lib/dayon-cloud.js does); everything here is pure and tested beside it.
 */
import { mergeStates, inUnitOf } from './sync-merge.js'

export const DOC_VERSION = 1
export const PLAN_DOC = 'atual'
export const ESTADO_DOC = 'atual'
// Below the rules' 1 000 000 characters (firestore.rules dataDoc), itself below 1 MiB.
export const MAX_JSON = 950000

// The plan, as a trainer edits it: what a workout is built from.
export const PLAN_FIELDS = [
  'routines', 'week', 'dayPlan', 'rotation', 'scheduleMode', 'queue', 'programmes', 'programme',
  'customEx', 'exWeights', 'exNotes', 'barWeights', 'exAliases', 'loadKind', 'dbLoad', 'stackWeights',
  'exUnit', 'balanceOverrides', 'exMerged',
]
// In both documents: every weight in either is in this unit.
const SHARED = ['unit', 'unitSet']
// Never leaves the device: the workout running now, the server's own notes, the Coach's chat.
export const LOCAL_ONLY = ['active', '_rev', '_wid', '_wids', '_unstamped', '_prior', 'coach']
// The bookkeeping that is split by the field it is about, not copied whole.
const META = ['edited', 'undone', 'deleted', '_ts', 'resetAt', 'resetIds']
const PLAN_DELETED = ['routines', 'customEx']

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const planSet = new Set(PLAN_FIELDS)
// `edited.week.3` is about `week`; `edited.routineOrder` is the order of the routines.
const isPlanStamp = k => k === 'routineOrder' || planSet.has(k.split('.')[0])
const pick = (m, keep) => {
  if (!isMap(m)) return null
  const out = {}
  for (const [k, v] of Object.entries(m)) if (keep(k)) out[k] = v
  return Object.keys(out).length ? out : null
}
const put = (o, k, v) => { if (v != null) o[k] = v }

/** The key a workout is stored under: its id (lib/sync-merge.js workoutKey), safe as a doc id. */
export function workoutDocId(w) {
  const key = String(w?.id != null ? w.id : `${w?.d}|${w?.start}`)
  const safe = key.replace(/\//g, '_')
  return safe === '.' || safe === '..' || /^__.*__$/.test(safe) ? 'w' + safe : safe
}

/** `S` as the documents' contents: { plan, estado, workouts: [{ id, w }] }. */
export function splitState(S) {
  const plan = {}, estado = {}
  for (const [k, v] of Object.entries(S || {})) {
    if (v === undefined || k === 'workouts' || LOCAL_ONLY.includes(k) || META.includes(k)) continue
    if (SHARED.includes(k)) { plan[k] = v; estado[k] = v }
    else if (planSet.has(k)) plan[k] = v
    else estado[k] = v
  }
  put(plan, 'edited', pick(S?.edited, isPlanStamp))
  put(estado, 'edited', pick(S?.edited, k => !isPlanStamp(k)))
  put(plan, 'undone', pick(S?.undone, isPlanStamp))
  put(estado, 'undone', pick(S?.undone, k => !isPlanStamp(k)))
  put(plan, 'deleted', pick(S?.deleted, k => PLAN_DELETED.includes(k)))
  put(estado, 'deleted', pick(S?.deleted, k => !PLAN_DELETED.includes(k)))
  put(estado, 'resetAt', S?.resetAt || null)
  put(estado, 'resetIds', S?.resetIds || null)
  const ts = Number(S?._ts) || 0
  plan._ts = ts
  estado._ts = ts
  const workouts = (Array.isArray(S?.workouts) ? S.workouts : []).filter(w => w && typeof w === 'object')
    .map(w => ({ id: workoutDocId(w), w }))
  return { plan, estado, workouts }
}

/**
 * The cloud's documents put back together as one copy of the state, to merge with `local`.
 * `plan` and `estado` are the documents' contents (or null when there is none yet), `workouts`
 * the workouts read this time (all of them on the first sync, the ones changed since after
 * that: the merge is a union, so the ones not read are this device's as they are). What the
 * cloud does not hold (the running workout, the Coach's chat, a document not written yet) is
 * `local`'s, so the merge keeps it. null when the cloud holds nothing at all.
 */
export function composeCloud(local, { plan = null, estado = null, workouts = [] } = {}) {
  if (!plan && !estado && !workouts.length) return null
  const mine = splitState(local)
  const e = isMap(estado) ? estado : mine.estado
  // The plan in the student's unit: a trainer's device may have written it in the other one.
  let p = isMap(plan) ? plan : mine.plan
  if (p.unit && e.unit && p.unit !== e.unit) p = inUnitOf(p, e)
  const out = {}
  for (const k of LOCAL_ONLY) if (local && k in local) out[k] = local[k]
  const strip = o => Object.fromEntries(Object.entries(o).filter(([k]) => !META.includes(k)))
  Object.assign(out, strip(e), strip(p))
  out.unit = e.unit || p.unit || local?.unit
  const unitSet = (Number(p.unitSet?.at) || 0) > (Number(e.unitSet?.at) || 0) ? p.unitSet : e.unitSet
  if (unitSet) out.unitSet = unitSet; else delete out.unitSet
  for (const f of ['edited', 'undone', 'deleted']) {
    const m = { ...(isMap(e[f]) ? e[f] : {}), ...(isMap(p[f]) ? p[f] : {}) }
    if (Object.keys(m).length) out[f] = m
  }
  if (e.resetAt) out.resetAt = e.resetAt
  if (e.resetIds) out.resetIds = e.resetIds
  out._ts = Math.max(Number(p._ts) || 0, Number(e._ts) || 0)
  out.workouts = workouts.map(x => x.w).filter(Boolean)
  return out
}

/** This device's copy with the cloud's: the app's own merge, the running workout kept. */
export function mergeCloud(local, cloud) {
  if (!cloud) return local
  const merged = mergeStates(local, cloud)
  for (const k of LOCAL_ONLY) {
    if (local && k in local) merged[k] = local[k]; else delete merged[k]
  }
  return merged
}

// FNV-1a over the JSON: enough to tell "changed since the cloud last had it" apart.
export function hashText(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36) + ':' + s.length
}
// A document's content without its `_ts` (applying a merge moves the stamp, not the content),
// keys in order: a merge may build the same object with its keys in another order.
const stable = (v, top) => {
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : stable(x))).join(',') + ']'
  if (!isMap(v)) return v === undefined ? undefined : JSON.stringify(v)
  const parts = []
  for (const k of Object.keys(v).sort()) {
    if (top && k === '_ts') continue
    const s = stable(v[k])
    if (s !== undefined) parts.push(JSON.stringify(k) + ':' + s)
  }
  return '{' + parts.join(',') + '}'
}
export const hashOf = o => hashText(stable(o, true) || '')
// A workout keeps its `_ts` in the hash: it is the workout's own edit stamp (stampWorkout).
export const hashWorkout = w => hashText(stable(w, false) || '')

/** What the cloud's documents were last known to hold: { plan, estado, w: { [id]: hash } }. */
export const emptyMeta = () => ({ since: null, plan: null, estado: null, w: {} })

/** The hashes of documents read from the cloud, recorded as what it holds. Mutates `meta`. */
export function noteRead(meta, { plan, estado, workouts = [], deleted = [] } = {}) {
  if (plan) meta.plan = hashOf(plan)
  if (estado) meta.estado = hashOf(estado)
  for (const { id, w } of workouts) meta.w[id] = hashWorkout(w)
  for (const id of deleted) delete meta.w[id]
  return meta
}

/**
 * What to write for `S` to be what the cloud holds, given `meta` (what it held): the plan and
 * the rest only when their content changed, the workouts that are new or changed, and the
 * workouts the cloud has that `S` records as removed (here, or by a merge that honoured a removal
 * made on another device; one `S` merely lacks is left there, in `kept`). `tooBig` names a document over MAX_JSON: it is left out and
 * said, never cut. Returns { plan, estado, upserts: [{ id, w, json }], deletes, tooBig, hashes }
 * with `plan` and `estado` as { json } or null, and `hashes` the meta once all of it is written.
 */
export function planWrites(S, meta = emptyMeta()) {
  const parts = splitState(S)
  const out = { plan: null, estado: null, upserts: [], deletes: [], kept: [], tooBig: [], hashes: { ...meta, w: { ...(meta.w || {}) } } }
  for (const f of ['plan', 'estado']) {
    const h = hashOf(parts[f])
    if (h === meta[f]) continue
    const json = JSON.stringify(parts[f])
    if (json.length > MAX_JSON) { out.tooBig.push(f); continue }
    out[f] = { json }
    out.hashes[f] = h
  }
  const have = new Set()
  for (const { id, w } of parts.workouts) {
    have.add(id)
    const h = hashWorkout(w)
    if (meta.w?.[id] === h) continue
    const json = JSON.stringify(w)
    if (json.length > MAX_JSON) { out.tooBig.push('workout:' + id); continue }
    out.upserts.push({ id, w, json })
    out.hashes.w[id] = h
  }
  // Only a removal the copy has on record (`deleted.workouts`, a reset's ids) is carried to the
  // cloud. A copy that merely lacks a workout (storage wiped, a backup restored over it) must not
  // empty the account's history: the merge would bring that workout back on every other device
  // anyway, as it does between two devices synced to a server.
  const gone = removedIds(S)
  for (const id of Object.keys(meta.w || {})) {
    if (have.has(id)) continue
    if (gone.has(id)) { out.deletes.push(id); delete out.hashes.w[id] }
    else out.kept.push(id)
  }
  return out
}

/** The document ids of the workouts `S` records as removed: by a removal stamp, or by a reset. */
export function removedIds(S) {
  const out = new Set()
  const del = isMap(S?.deleted?.workouts) ? S.deleted.workouts : {}
  for (const [k, at] of Object.entries(del)) if (Number(at) > 0) out.add(workoutDocId({ id: k }))
  const reset = S?.resetIds?.workouts
  for (const k of Array.isArray(reset) ? reset : isMap(reset) ? Object.keys(reset) : []) out.add(workoutDocId({ id: k }))
  return out
}

/** Whether `planWrites` found anything to send. */
export const hasWrites = p => !!(p && (p.plan || p.estado || p.upserts.length || p.deletes.length))

/** A document's content, or null for one that is not ours or does not parse. */
export function readDoc(data) {
  if (!data || typeof data.json !== 'string') return null
  try {
    const v = JSON.parse(data.json)
    return v && typeof v === 'object' ? v : null
  } catch { return null }
}
