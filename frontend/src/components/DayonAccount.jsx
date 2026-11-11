// DAYON - Treino: "Sign in to Dayon" (email and password) and the Dayon account once signed in:
// how the sync stands, Sync now, trainer and student codes, Sign out (store/useDayon.js,
// docs/dayon/PAINEL.md). Opened from the first-launch screen, from Settings → Account, and on
// the website as the screen in front of the app (DayonGate).
import { useEffect, useState } from 'react'
import { useDayon } from '../store/useDayon.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button, Segmented, Row, Section } from './ui.jsx'
import DayonLogo from './DayonLogo.jsx'
import { dayonMessage } from '../lib/dayon-errors.js'
import { CLOUD_SITE } from '../lib/dayon-config.js'
import { copyText } from '../lib/clipboard.js'
import { nav } from '../lib/nav.js'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)

/** One line for how the Dayon sync stands (Settings → Account, the account sheet). */
export function dayonStatusText(st) {
  switch (st.status) {
    case 'syncing': return t('Syncing…')
    case 'ok': return t('Synced with the Dayon cloud')
    case 'offline': return t('Offline: changes stay on this device and sync later.')
    case 'paused': return t('Paused: this device syncs with your own server.')
    case 'error': return st.error || t('Something went wrong. Try again.')
    default: return st.choice ? t('Waiting for your answer') : t('Signed in')
  }
}

const roleText = papel => (papel === 'personal' ? t('Trainer') : t('Student'))

/** The sign-in / create-account form. `onDone` after a successful sign-in. */
export function DayonForm({ onDone }) {
  const available = useDayon(s => s.available)
  const [mode, setMode] = useState('in')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!available) return <div className="muted small" role="note" style={{ lineHeight: 1.5 }}>{dayonMessage({ code: 'dayon/unconfigured' })}</div>
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      const d = useDayon.getState()
      if (mode === 'new') await d.signUp({ nome: nome.trim(), email, senha })
      else await d.signIn({ email, senha })
      onDone?.()
    } catch (e) { setError(dayonMessage(e)) }
    finally { setBusy(false) }
  }
  const forgot = async () => {
    setError('')
    try { await useDayon.getState().resetPassword(email); toast(t('We sent a link to reset your password to {0}.', email.trim())) }
    catch (e) { setError(dayonMessage(e)) }
  }
  const field = { marginTop: 8 }
  // The switch stays outside the form: its buttons would submit it.
  return <div className="dayon-form">
    <Segmented value={mode} onChange={v => { setMode(v); setError('') }}
      options={[{ value: 'in', label: t('Sign in') }, { value: 'new', label: t('Create account') }]} />
    <form onSubmit={e => { e.preventDefault(); if (!busy) go() }}>
    {mode === 'new' && <input className="input" style={field} placeholder={t('Your name')} aria-label={t('Your name')} value={nome}
      onChange={e => setNome(e.target.value)} autoComplete="name" maxLength={80} />}
    <input className="input" style={field} type="email" placeholder={t('Email')} aria-label={t('Email')} value={email}
      onChange={e => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" inputMode="email" />
    <input className="input" style={field} type="password" placeholder={t('Password')} aria-label={t('Password')} value={senha}
      onChange={e => setSenha(e.target.value)} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} />
    {mode === 'new' && <div className="dim small" style={{ marginTop: 6 }}>{t('At least 6 characters.')}</div>}
    {error && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 8, lineHeight: 1.45 }}>{error}</div>}
    <div style={{ height: 10 }} />
    <Button variant="primary" type="submit" disabled={busy}>{busy ? t('Please wait…') : mode === 'new' ? t('Create account') : t('Sign in')}</Button>
    {mode === 'in' && <Button variant="ghost" className="dim" type="button" onClick={forgot} disabled={busy}>{t('Forgot your password?')}</Button>}
    </form>
  </div>
}

// Signed in over a copy that belongs to another Dayon account: merge it in, or leave.
function ChoiceCard() {
  const email = useDayon(s => s.user?.email)
  return <div>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('This device has data from another Dayon account. Merge it into {0}?', email || '')}
    </div>
    <Button variant="primary" onClick={() => useDayon.getState().resolveChoice(true)}>{t('Merge')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => useDayon.getState().resolveChoice(false)}>{t('Sign out')}</Button>
  </div>
}

// A small "enter a code" row: the trainer code from Dayon, or a code from your trainer. What went
// wrong stays written under it (a toast alone was easy to miss behind the sheet). A trainer code
// is `exact`: used as typed, never capitalised (Firestore ids are case-sensitive).
function CodeField({ placeholder, button, onSubmit, exact = false }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true)
    setError('')
    try { await onSubmit(code); setCode('') }
    catch (e) { const m = dayonMessage(e); setError(m); toast(m) }
    finally { setBusy(false) }
  }
  return <>
    <div style={{ display: 'flex', gap: 8, padding: '6px 16px 10px' }}>
      <input className="input" style={{ flex: 1, letterSpacing: '.06em', textTransform: exact ? 'none' : 'uppercase' }} placeholder={placeholder} aria-label={placeholder}
        value={code} onChange={e => { setCode(e.target.value); setError('') }} autoCapitalize={exact ? 'none' : 'characters'} autoCorrect="off" spellCheck={false} />
      <Button size="sm" onClick={go} disabled={busy || !code.trim()}>{busy ? t('Please wait…') : button}</Button>
    </div>
    {error && <div className="small" role="alert" style={{ color: 'var(--red)', padding: '0 16px 10px', lineHeight: 1.45 }}>{error}</div>}
  </>
}

/** A code to hand over, big, with Copy beside it. */
export function CodeToShare({ code }) {
  const copy = async () => toast(await copyText(code) ? t('Code copied') : t('Could not copy'))
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 12px' }}>
    <span data-testid="invite-code" style={{ flex: 1, fontSize: 22, fontWeight: 700, letterSpacing: '.08em', fontVariantNumeric: 'tabular-nums', userSelect: 'all' }}>{code}</span>
    <Button size="sm" variant="tinted" icon="copy" onClick={copy}>{t('Copy')}</Button>
  </div>
}

/** The student's active trainers, by name, each with "End link" (firestore.rules alunoDe lets
 *  a student read the name). `version` reloads it after a new link. */
export function MyTrainers({ uid, version = 0 }) {
  const [list, setList] = useState(null)
  const load = async () => {
    try {
      const c = await import('../lib/dayon-cloud.js')
      const { comoAluno } = await c.meusVinculos(uid)
      const active = comoAluno.filter(v => v.status === 'ativo')
      const names = await Promise.all(active.map(v => c.nomeDe(v.personalId)))
      setList(active.map((v, i) => ({ personalId: v.personalId, nome: names[i] || '' })))
    } catch { setList(xs => xs || []) }
  }
  useEffect(() => { if (uid) load() }, [uid, version])
  if (!list?.length) return null
  const end = p => confirmSheet({
    title: t('End the link with {0}?', p.nome || t('your trainer')),
    message: t('Your trainer will no longer see your history or edit your plan. Your data stays with you.'),
    confirmText: t('End link'),
    danger: true,
    onConfirm: async () => {
      try {
        await (await import('../lib/dayon-cloud.js')).encerrarVinculo(p.personalId, uid)
        setList(xs => (xs || []).filter(x => x.personalId !== p.personalId))
        toast(t('Link ended'))
      } catch (e) { toast(dayonMessage(e)) }
    },
  })
  return list.map(p => <Row key={p.personalId} icon="personCircle" iconTint="var(--acc)" title={p.nome || t('Your trainer')} subtitle={t('Your trainer')}>
    <Button size="sm" variant="ghost" className="danger" onClick={() => end(p)}>{t('End link')}</Button>
  </Row>)
}

/** Signed in: the account, how the sync stands, codes, Sign out. */
export function DayonSignedIn({ close }) {
  const st = useDayon()
  const [inviteCode, setInviteCode] = useState('')
  const [links, setLinks] = useState(0)
  const uid = st.user?.uid
  const cloud = () => import('../lib/dayon-cloud.js')
  const becomeTrainer = async code => {
    await (await cloud()).tornarPersonal(uid, code)
    useDayon.setState(s => ({ perfil: { ...(s.perfil || {}), papel: 'personal' } }))
    toast(t('You are now a trainer on Dayon.'))
  }
  const linkTrainer = async code => {
    const r = await (await cloud()).ligarAoPersonal(uid, code)
    toast(r.personalNome ? t('Linked to {0}.', r.personalNome) : t('Linked to your trainer.'))
    setLinks(n => n + 1)
  }
  const openPanel = () => { close?.(); nav('/trainer') }
  const newInvite = async () => {
    try { setInviteCode(await (await cloud()).criarConviteAluno(uid, st.perfil?.nome || st.user?.nome || '')) }
    catch (e) { toast(dayonMessage(e)) }
  }
  const signOut = async wipe => {
    try { await st.signOut() } catch (e) { toast(dayonMessage(e)); return }
    close?.()
    if (wipe) { useDayon.getState().forgetDevice(); window.location.reload(); return }
    toast(t('Signed out of Dayon. Your data stays on this device.'))
  }
  if (st.choice) return <ChoiceCard />
  const papel = st.perfil?.papel
  return <>
    <Section footer={t('Signing out keeps everything on this device.')}>
      <Row icon="personCircle" iconTint="var(--acc)" title={st.perfil?.nome || st.user?.nome || st.user?.email}
        subtitle={[st.user?.email, papel ? roleText(papel) : null].filter(Boolean).join(' · ')} />
      <Row icon={st.status === 'offline' ? 'cloudSlash' : 'cloud'} iconTint="var(--indigo)" title={t('Dayon cloud')} subtitle={dayonStatusText(st)} />
      {st.status !== 'paused' && <Row icon="repeat" iconTint="var(--blue)" title={t('Sync now')} accessory="chevron" onClick={() => st.syncNow()} />}
      <Row icon="signOut" iconTint="var(--red)" title={t('Sign out of Dayon')} danger onClick={() => signOut(false)} />
      {CLOUD_SITE && <Row icon="trash" iconTint="var(--red)" title={t('Sign out and clear this browser')} danger onClick={() => signOut(true)} />}
    </Section>
    {papel === 'personal' ? <Section title={t('Trainer')} footer={t('Share this code with your student. It works once.')}>
      <Row icon="person" iconTint="var(--acc)" title={t('Trainer panel')} subtitle={t('Your students, their plans and history')} accessory="chevron" onClick={openPanel} />
      <Row icon="plus" iconTint="var(--acc)" title={t('Create a code for a student')} accessory="chevron" onClick={newInvite} />
      {inviteCode && <CodeToShare code={inviteCode} />}
    </Section> : papel === 'aluno' ? <>
      <Section title={t('Your trainer')} footer={t('Your trainer sees your history and can edit your plan. You can still edit it too.')}>
        <MyTrainers uid={uid} version={links} />
        <CodeField placeholder={t('Code from your trainer')} button={t('Link')} onSubmit={linkTrainer} />
      </Section>
      <Section title={t('Are you a trainer?')} footer={t('Dayon gives trainers a code. It works once.')}>
        <CodeField placeholder={t('Trainer code')} button={t('Use')} onSubmit={becomeTrainer} exact />
      </Section>
    </> : null}
  </>
}

/** The sheet: the form while signed out, the account once signed in. */
export function DayonAccountSheet({ close, onSignedIn }) {
  const user = useDayon(s => s.user)
  return <div className="kb-lift">
    <h3>{user ? t('Dayon account') : t('Sign in to Dayon')}</h3>
    {!user && <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
      {t('Your plan and history in the Dayon cloud, on the app and on the website. Optional: the app works the same without it.')}
    </div>}
    {user ? <DayonSignedIn close={close} /> : <DayonForm onDone={() => { onSignedIn?.(close) }} />}
  </div>
}

export const openDayonAccount = opts => useUI.getState().openSheet(close => <DayonAccountSheet close={close} {...opts} />)

/** The website: signed out, this is what shows instead of the app. */
export function DayonGate() {
  const st = useDayon()
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
  return <div className="narrow" style={wrap}>
    <div style={{ display: 'flex', justifyContent: 'center' }}><DayonLogo size={46} /></div>
    <h1 className="t-large" style={{ fontWeight: 700, margin: '14px 0 4px' }}>Treino</h1>
    <div className="muted" style={{ marginBottom: 22 }}>{t('See your workout on the web. Sign in with your Dayon account.')}</div>
    <div style={{ textAlign: 'left' }}>
      {!st.authReady ? <div className="dim small" style={{ textAlign: 'center' }}>{t('Please wait…')}</div>
        : st.user && st.choice ? <ChoiceCard /> : <DayonForm />}
    </div>
  </div>
}
