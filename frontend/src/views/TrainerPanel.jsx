// DAYON - Treino: the trainer's panel (docs/dayon/PAINEL.md, etapa 3). Opened from Settings →
// Account and from the Dayon account sheet when the profile is a trainer's.
//
//   /trainer           codes for new students (make, copy, cancel) and the students linked
//   /trainer/:alunoId  one student: edit the plan (the app's own plan screens, on a stand-in copy:
//                      store/useTrainer.js), the history read only, and ending the link
//
// Light on the Spark plan's reads: the list reads each active student's name and one workout
// (the newest, for "last workout"), never a whole history; the history page reads 30 at a time.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDayon } from '../store/useDayon.js'
import { useUI } from '../store/useUI.js'
import { useTrainer } from '../store/useTrainer.js'
import { t, tn, exerciseNameFor } from '../lib/i18n.js'
import { fmtDate, fmtDur } from '../lib/format.js'
import { setLabel, setsDone } from '../lib/history.js'
import { hasCompletedWork } from '../lib/workout-model.js'
import { EXIDX } from '../lib/exercises.js'
import { copyText } from '../lib/clipboard.js'
import { dayonMessage } from '../lib/dayon-errors.js'
import * as dayonCloud from '../lib/dayon-cloud.js'
import { studentRows, readNames, rememberNames } from '../lib/dayon-trainer.js'
import { confirmSheet } from '../sheets.jsx'
import { Button, Row, Section } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { CodeToShare } from '../components/DayonAccount.jsx'

// The panel is its own lazily loaded chunk, so the cloud module comes with it (Firebase itself
// still loads on first use, lib/dayon-cloud.js sdk).
const cloud = async () => dayonCloud
const toast = m => useUI.getState().toast(m)
// A workout from the cloud may lack what a local one always has: count it without throwing.
const setCount = w => { try { return setsDone(w) } catch { return 0 } }
const ls = () => { try { return globalThis.localStorage || null } catch { return null } }

/** The words for a link's status. */
export const statusText = s => (s === 'ativo' ? t('Active') : s === 'encerrado' ? t('Ended') : t('Pending'))
/** "Last workout" on a student's row. */
export const lastText = d => (d ? t('Last workout {0}', fmtDate(d, true)) : t('No workouts yet'))

/** Copies a student code and says so. */
export async function copyCode(code) {
  toast(await copyText(code) ? t('Code copied') : t('Could not copy'))
}

function Header({ title, sub, back, nav }) {
  return <div className="hdr">
    <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12, minWidth: 0 }}><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
  </div>
}

// Not a trainer (or signed out): the panel has nothing to show.
function NotTrainer({ nav }) {
  return <div className="narrow">
    <Header title={t('Trainer panel')} back="/settings/account" nav={nav} />
    <EmptyState icon="person" text={t('The trainer panel is for Dayon trainers. Sign in with a trainer account in Settings → Account.')} />
  </div>
}

export function TrainerPanel() {
  const nav = useNavigate()
  const uid = useDayon(s => s.user?.uid)
  const perfil = useDayon(s => s.perfil)
  const userNome = useDayon(s => s.user?.nome)
  const [code, setCode] = useState('')
  const [making, setMaking] = useState(false)
  const [invites, setInvites] = useState(null)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const trainer = perfil?.papel === 'personal'

  const load = async () => {
    if (!uid) return
    setError('')
    try {
      const c = await cloud()
      const [{ comoPersonal }, open] = await Promise.all([c.meusVinculos(uid), c.convitesAbertos(uid).catch(() => [])])
      setInvites(open)
      const active = comoPersonal.filter(v => v.status === 'ativo')
      const [names, last] = await Promise.all([
        Promise.all(active.map(v => c.nomeDe(v.alunoId))),
        Promise.all(active.map(v => c.ultimoTreino(v.alunoId).catch(() => null))),
      ])
      const known = rememberNames(ls(), Object.fromEntries(active.map((v, i) => [v.alunoId, names[i]])))
      setRows(studentRows(comoPersonal, known, Object.fromEntries(active.map((v, i) => [v.alunoId, last[i]]))))
    } catch (e) { setError(dayonMessage(e)); setRows(r => r || []) }
  }
  useEffect(() => { if (trainer) load() }, [uid, trainer])

  if (!uid || !trainer) return <NotTrainer nav={nav} />

  const newInvite = async () => {
    setMaking(true)
    try {
      const c = await (await cloud()).criarConviteAluno(uid, perfil?.nome || userNome || '')
      setCode(c)
      setInvites(xs => [{ codigo: c, ativo: true, usadoPor: null }, ...(xs || [])])
    } catch (e) { toast(dayonMessage(e)) }
    finally { setMaking(false) }
  }
  const cancel = codigo => confirmSheet({
    title: t('Cancel this code?'),
    message: t('Nobody can use {0} after this.', codigo),
    confirmText: t('Cancel code'),
    cancelText: t('Keep it'),
    danger: true,
    onConfirm: async () => {
      try {
        await (await cloud()).cancelarConviteAluno(codigo)
        setInvites(xs => (xs || []).filter(x => x.codigo !== codigo))
        if (code === codigo) setCode('')
        toast(t('Code cancelled'))
      } catch (e) { toast(dayonMessage(e)) }
    },
  })
  const others = (invites || []).filter(x => x.codigo !== code)

  return <div className="narrow trainer-panel">
    <Header title={t('Trainer panel')} sub={perfil?.nome || userNome || ''} back="/settings/account" nav={nav} />
    <Section title={t('Invite a student')} footer={t('Share this code with your student. It works once.')}>
      <Row icon="plus" iconTint="var(--acc)" title={making ? t('Please wait…') : t('Create a code for a student')} accessory="chevron" onClick={making ? undefined : newInvite} />
      {code && <CodeToShare code={code} />}
      {code && <Row icon="xmark" iconTint="var(--red)" title={t('Cancel code')} danger onClick={() => cancel(code)} />}
    </Section>
    {others.length > 0 && <Section title={t('Codes not used yet')}>
      {others.map(x => <Row key={x.codigo} icon="key" iconTint="var(--orange)" title={x.codigo}>
        <button type="button" className="iconbtn" aria-label={t('Copy {0}', x.codigo)} onClick={() => copyCode(x.codigo)}><Icon name="copy" /></button>
        <button type="button" className="iconbtn" aria-label={t('Cancel {0}', x.codigo)} onClick={() => cancel(x.codigo)}><Icon name="xmark" /></button>
      </Row>)}
    </Section>}
    <Section title={t('Students')} footer={error || (rows && rows.length ? null : t('A student enters your code in Settings → Account → Dayon account.'))}>
      {rows === null ? <Row icon="person" iconTint="var(--grey)" title={t('Please wait…')} />
        : !rows.length ? <Row icon="person" iconTint="var(--grey)" title={t('No students yet')} />
        : rows.map(r => <Row key={r.alunoId} icon="personCircle" iconTint={r.status === 'ativo' ? 'var(--acc)' : 'var(--grey)'}
          title={r.nome || t('Student')}
          subtitle={[statusText(r.status), r.status === 'ativo' ? lastText(r.ultimo) : null].filter(Boolean).join(' · ')}
          accessory={r.status === 'ativo' ? 'chevron' : 'none'}
          onClick={r.status === 'ativo' ? () => nav('/trainer/' + encodeURIComponent(r.alunoId), { state: { nome: r.nome } }) : undefined} />)}
    </Section>
  </div>
}

/* ---------------- one student ---------------- */

// One workout as it was logged, read only: the exercises and their completed sets.
function ReadOnlyWorkout({ w }) {
  const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))
  return <div>
    <h3>{w.name || t('Workout')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{[fmtDate(w.d, true), w.end && w.start ? fmtDur(w.end - w.start) : null, tn('{0} set', '{0} sets', setCount(w))].filter(Boolean).join(' · ')}</div>
    <div className="list">{(w.entries || []).map((e, i) => {
      const sets = (e.sets || []).filter(hasCompletedWork)
      return <div key={i} className="item" style={{ display: 'block' }}>
        <div className="tt" style={{ fontWeight: 600 }}>{nameOf(e)}</div>
        <div className="ss">{sets.length ? sets.map(s => setLabel(e.id, s, e.target)).join('  ·  ') : t('no sets')}</div>
        {e.note && <div className="small dim" style={{ marginTop: 3 }}>{e.note}</div>}
      </div>
    })}</div>
    {w.note && <div className="small muted" style={{ marginTop: 10, lineHeight: 1.45 }}>{w.note}</div>}
    <div className="dim small" style={{ marginTop: 12 }}>{t('Read only: only the student edits their workouts.')}</div>
  </div>
}
const openWorkout = w => useUI.getState().openSheet(() => <ReadOnlyWorkout w={w} />)

export function TrainerStudent() {
  const nav = useNavigate()
  const { alunoId: raw } = useParams()
  const alunoId = decodeURIComponent(raw || '')
  const uid = useDayon(s => s.user?.uid)
  const trainer = useDayon(s => s.perfil?.papel === 'personal')
  const [nome, setNome] = useState(() => readNames(ls())[alunoId] || '')
  const [ws, setWs] = useState(null)
  const [next, setNext] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const page = async after => {
    setBusy(true)
    try {
      const r = await (await cloud()).lerTreinosAluno(alunoId, { depois: after })
      setWs(xs => [...(after ? xs || [] : []), ...r.workouts])
      setNext(r.next)
    } catch (e) { setError(dayonMessage(e)); setWs(xs => xs || []) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!uid || !trainer || !alunoId) return
    cloud().then(c => c.nomeDe(alunoId)).then(n => { if (n) { setNome(n); rememberNames(ls(), { [alunoId]: n }) } }).catch(() => {})
    page(null)
  }, [uid, trainer, alunoId])

  if (!uid || !trainer) return <NotTrainer nav={nav} />
  const who = nome || t('Student')

  const editPlan = async () => {
    try {
      const ok = await useTrainer.getState().open({ alunoId, nome: who })
      if (ok) nav('/plan')
      else toast(t('Finish what is open first.'))
    } catch (e) { toast(dayonMessage(e)) }
  }
  const end = () => confirmSheet({
    title: t('End the link with {0}?', who),
    message: t('You will no longer see their history or edit their plan. Their data stays with them. A new code links you again.'),
    confirmText: t('End link'),
    danger: true,
    onConfirm: async () => {
      try {
        await (await cloud()).encerrarVinculo(uid, alunoId)
        toast(t('Link ended'))
        nav('/trainer')
      } catch (e) { toast(dayonMessage(e)) }
    },
  })

  return <div className="narrow trainer-student">
    <Header title={who} sub={t('Student')} back="/trainer" nav={nav} />
    <Section title={t('Plan')} footer={t('Routines and weekly schedule, on the same screens as your own plan. Your plan stays as it is.')}>
      <Row icon="clipboard" iconTint="var(--acc)" title={t('Edit plan')} accessory="chevron" onClick={editPlan} />
    </Section>
    <Section title={t('History')} footer={error || t('Read only: only the student edits their workouts.')}>
      {ws === null ? <Row icon="history" iconTint="var(--grey)" title={t('Please wait…')} />
        : !ws.length ? <Row icon="history" iconTint="var(--grey)" title={t('No workouts yet')} />
        : ws.map((w, i) => <Row key={w.id ?? i} icon="dumbbell" iconTint="var(--indigo)" title={w.name || t('Workout')}
          subtitle={[fmtDate(w.d, true), tn('{0} set', '{0} sets', setCount(w))].join(' · ')} accessory="chevron" onClick={() => openWorkout(w)} />)}
      {next && <Row icon="chevronDown" iconTint="var(--blue)" title={busy ? t('Please wait…') : t('Show more')} onClick={busy ? undefined : () => page(next)} />}
    </Section>
    <Section>
      <Row icon="xmark" iconTint="var(--red)" title={t('End link')} danger onClick={end} />
    </Section>
  </div>
}

export default TrainerPanel
