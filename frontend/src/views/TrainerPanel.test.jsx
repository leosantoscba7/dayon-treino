// @vitest-environment happy-dom
// DAYON - Treino, etapa 3: the trainer's panel (views/TrainerPanel.jsx) and the student's side of
// a link in the Dayon account (components/DayonAccount.jsx MyTrainers). Firebase is a stand-in.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ navs: [], params: {}, confirms: [], toast: vi.fn(), copied: [], sheets: [] }))
const cloud = vi.hoisted(() => ({
  criarConviteAluno: vi.fn(async () => 'K7PM-2QXH-9RTA'),
  convitesAbertos: vi.fn(async () => []),
  cancelarConviteAluno: vi.fn(async () => {}),
  meusVinculos: vi.fn(async () => ({ comoAluno: [], comoPersonal: [] })),
  nomeDe: vi.fn(async () => null),
  ultimoTreino: vi.fn(async () => null),
  lerTreinosAluno: vi.fn(async () => ({ workouts: [], next: null })),
  encerrarVinculo: vi.fn(async () => {}),
  ligarAoPersonal: vi.fn(async () => ({ personalNome: 'Léo' })),
}))
vi.mock('../lib/dayon-cloud.js', () => cloud)
vi.mock('react-router-dom', () => ({ useNavigate: () => (to, o) => h.navs.push(to), useParams: () => h.params }))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async text => { h.copied.push(text); return true }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: opts => h.confirms.push(opts) }))
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => h.toast(...a), openSheet: render => { h.sheets.push(render); return {} } })
  const useUI = sel => (sel ? sel(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/nav.js', () => ({ nav: to => h.navs.push(to) }))

const mocked = await import('../lib/dayon-cloud.js')
const { useDayon } = await import('../store/useDayon.js')
const { TrainerPanel, TrainerStudent } = await import('./TrainerPanel.jsx')
const { MyTrainers, DayonSignedIn } = await import('../components/DayonAccount.jsx')

let host, root
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)) })
const render = async el => { act(() => root.render(el)); await flush() }
const click = async el => { act(() => el.click()); await flush() }
const byText = (txt, sel = 'button, .lrow') => [...host.querySelectorAll(sel)].find(e => e.textContent.includes(txt))
const confirmLast = async () => { const c = h.confirms.at(-1); act(() => { c.onConfirm() }); await flush() }

beforeEach(() => {
  Object.assign(h, { navs: [], params: {}, confirms: [], copied: [], sheets: [] })
  h.toast.mockClear()
  for (const f of Object.values(cloud)) f.mockClear()
  localStorage.clear()
  useDayon.setState({ user: { uid: 'p1', email: 'p@d.c', nome: 'Léo' }, perfil: { nome: 'Léo', papel: 'personal' }, status: 'ok' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useDayon.setState({ user: null, perfil: null, status: 'off' })
})

describe('the trainer panel', () => {
  it('the cloud here is the stand-in (no request reaches Firebase from these tests)', () => {
    expect(mocked.lerTreinosAluno).toBe(cloud.lerTreinosAluno)
  })
  it('is only for trainers', async () => {
    useDayon.setState({ perfil: { nome: 'Ana', papel: 'aluno' } })
    await render(<TrainerPanel />)
    expect(host.textContent).toContain('The trainer panel is for Dayon trainers.')
    expect(cloud.meusVinculos).not.toHaveBeenCalled()
  })

  it('makes a student code, shows it big, and copies it with a toast', async () => {
    await render(<TrainerPanel />)
    await click(byText('Create a code for a student'))
    expect(cloud.criarConviteAluno).toHaveBeenCalledWith('p1', 'Léo')
    expect(host.querySelector('[data-testid="invite-code"]').textContent).toBe('K7PM-2QXH-9RTA')
    await click(byText('Copy', 'button'))
    expect(h.copied).toEqual(['K7PM-2QXH-9RTA'])
    expect(h.toast).toHaveBeenCalledWith('Code copied')
  })

  it('a code not used yet can be cancelled, after a confirmation', async () => {
    cloud.convitesAbertos.mockResolvedValueOnce([{ codigo: 'AAAA-BBBB-CCCC', ativo: true, usadoPor: null }])
    await render(<TrainerPanel />)
    expect(host.textContent).toContain('AAAA-BBBB-CCCC')
    await click(host.querySelector('[aria-label="Cancel AAAA-BBBB-CCCC"]'))
    expect(cloud.cancelarConviteAluno).not.toHaveBeenCalled()
    await confirmLast()
    expect(cloud.cancelarConviteAluno).toHaveBeenCalledWith('AAAA-BBBB-CCCC')
    expect(host.textContent).not.toContain('AAAA-BBBB-CCCC')
  })

  it('lists the students: name, status and last workout, reading one workout each', async () => {
    cloud.meusVinculos.mockResolvedValueOnce({ comoAluno: [], comoPersonal: [
      { alunoId: 'a1', personalId: 'p1', status: 'ativo' },
      { alunoId: 'a2', personalId: 'p1', status: 'ativo' },
      { alunoId: 'a3', personalId: 'p1', status: 'encerrado' },
    ] })
    cloud.nomeDe.mockImplementation(async id => ({ a1: 'Bia', a2: 'Caio' })[id] || null)
    cloud.ultimoTreino.mockImplementation(async id => (id === 'a1' ? '2026-11-09' : null))
    await render(<TrainerPanel />)
    const rows = [...host.querySelectorAll('.lrow')].map(r => r.textContent)
    const bia = rows.find(r => r.includes('Bia'))
    expect(bia).toContain('Active')
    expect(bia).toContain('Last workout')
    expect(rows.find(r => r.includes('Caio'))).toContain('No workouts yet')
    expect(rows.some(r => r.includes('Ended'))).toBe(true)
    // the ended link is not read: no name, no workouts
    expect(cloud.nomeDe).not.toHaveBeenCalledWith('a3')
    expect(cloud.ultimoTreino).toHaveBeenCalledTimes(2)
    await click(byText('Bia'))
    expect(h.navs).toEqual(['/trainer/a1'])
  })
})

describe('one student', () => {
  beforeEach(() => { h.params = { alunoId: 'a1' } })

  it('shows the history read only, and ends the link after a confirmation', async () => {
    cloud.nomeDe.mockResolvedValue('Bia')
    cloud.lerTreinosAluno.mockResolvedValueOnce({ workouts: [{ id: 'w1', d: '2026-11-09', name: 'Push', entries: [{ id: 'x', sets: [{ w: 40, r: 8, done: true }] }] }], next: null })
    await render(<TrainerStudent />)
    await act(() => vi.waitFor(() => expect(host.textContent).toContain('Push')))
    expect(cloud.lerTreinosAluno).toHaveBeenCalledWith('a1', { depois: null })
    expect(host.querySelector('h1').textContent).toBe('Bia')
    expect(host.textContent).toContain('Read only')
    // no edit or delete of a workout anywhere on the page
    expect(byText('Delete', 'button')).toBeUndefined()
    await click(byText('End link'))
    expect(h.confirms.at(-1).title).toBe('End the link with Bia?')
    expect(cloud.encerrarVinculo).not.toHaveBeenCalled()
    await confirmLast()
    expect(cloud.encerrarVinculo).toHaveBeenCalledWith('p1', 'a1')
    expect(h.toast).toHaveBeenCalledWith('Link ended')
    expect(h.navs).toContain('/trainer')
  })
})

describe('the student\'s side', () => {
  beforeEach(() => { useDayon.setState({ user: { uid: 'a1', email: 'a@d.c' }, perfil: { nome: 'Bia', papel: 'aluno' } }) })

  it('shows the trainer by name, and ends the link after a confirmation', async () => {
    cloud.meusVinculos.mockResolvedValueOnce({ comoAluno: [{ alunoId: 'a1', personalId: 'p1', status: 'ativo' }, { alunoId: 'a1', personalId: 'p9', status: 'encerrado' }], comoPersonal: [] })
    cloud.nomeDe.mockResolvedValue('Léo')
    await render(<MyTrainers uid="a1" />)
    expect(host.textContent).toContain('Léo')
    expect(cloud.nomeDe).toHaveBeenCalledTimes(1)
    await click(byText('End link', 'button'))
    await confirmLast()
    expect(cloud.encerrarVinculo).toHaveBeenCalledWith('p1', 'a1')
    expect(host.textContent).not.toContain('Léo')
  })

  it('the account sheet lists the trainer under "Your trainer"', async () => {
    cloud.meusVinculos.mockResolvedValue({ comoAluno: [{ alunoId: 'a1', personalId: 'p1', status: 'ativo' }], comoPersonal: [] })
    cloud.nomeDe.mockResolvedValue('Léo')
    await render(<DayonSignedIn />)
    expect(host.textContent).toContain('Your trainer')
    expect(host.textContent).toContain('Léo')
  })

  it('a trainer\'s account sheet opens the panel', async () => {
    useDayon.setState({ user: { uid: 'p1', email: 'p@d.c' }, perfil: { nome: 'Léo', papel: 'personal' } })
    const close = vi.fn()
    await render(<DayonSignedIn close={close} />)
    await click(byText('Trainer panel'))
    expect(close).toHaveBeenCalled()
    expect(h.navs).toEqual(['/trainer'])
  })
})
