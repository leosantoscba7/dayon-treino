// Testes das regras do Firestore (../firestore.rules) no emulador local.
//
//   cd firestore-tests && npm install && npm test
//
// `npm test` sobe o emulador do Firestore (precisa de Java 11 ou mais novo instalado) e roda
// estes testes contra ele; nada vai para o projeto real (o projeto "demo-dayon" só existe no
// emulador). Com um emulador já ligado: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:emulador-ja-ligado
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, it } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore'

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
let env

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dayon',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  })
})
after(async () => { await env?.cleanup() })
beforeEach(async () => { await env.clearFirestore() })

// Quem é quem nos testes.
const ALUNA = 'aluna1', ALUNO2 = 'aluno2', P1 = 'personal1', P2 = 'personal2', ESTRANHO = 'estranho'
const email = uid => `${uid}@exemplo.com`
const as = uid => env.authenticatedContext(uid, { email: email(uid) }).firestore()
const anon = () => env.unauthenticatedContext().firestore()
const dataDoc = (uid, extra = {}) => ({ v: 1, json: '{"routines":[]}', ts: 1, atualizadoEm: serverTimestamp(), por: uid, ...extra })

// Estado inicial escrito sem regras (o que o Console ou o próprio app já teriam feito).
async function seed(fn) { await env.withSecurityRulesDisabled(ctx => fn(ctx.firestore())) }
const perfil = (uid, papel = 'aluno') => ({ nome: uid, papel, email: email(uid), criadoEm: new Date(0), atualizadoEm: new Date(0) })
async function baseUsers() {
  await seed(async db => {
    for (const uid of [ALUNA, ALUNO2, ESTRANHO]) await setDoc(doc(db, 'users', uid), perfil(uid))
    for (const uid of [P1, P2]) await setDoc(doc(db, 'users', uid), perfil(uid, 'personal'))
    await setDoc(doc(db, `users/${ALUNA}/plan/atual`), { v: 1, json: '{}', ts: 1, atualizadoEm: new Date(0), por: ALUNA })
    await setDoc(doc(db, `users/${ALUNA}/workouts/w1`), { v: 1, json: '{}', ts: 1, d: '2026-11-01', atualizadoEm: new Date(0), por: ALUNA })
    await setDoc(doc(db, `users/${ALUNO2}/plan/atual`), { v: 1, json: '{}', ts: 1, atualizadoEm: new Date(0), por: ALUNO2 })
    await setDoc(doc(db, `users/${ALUNO2}/workouts/w9`), { v: 1, json: '{}', ts: 1, d: '2026-11-01', atualizadoEm: new Date(0), por: ALUNO2 })
  })
}
const vinculo = (personalId, alunoId, status = 'ativo') => seed(db => setDoc(doc(db, 'vinculos', `${personalId}_${alunoId}`),
  { personalId, alunoId, status, conviteUsado: 'semente', criadoEm: new Date(0), atualizadoEm: new Date(0) }))
const convitePersonal = (codigo, extra = {}) => seed(db => setDoc(doc(db, 'convitesPersonal', codigo),
  { ativo: true, usadoPor: null, usadoEm: null, criadoEm: new Date(0), ...extra }))
const conviteAluno = (codigo, personalId, extra = {}) => seed(db => setDoc(doc(db, 'convitesAluno', codigo),
  { personalId, personalNome: personalId, ativo: true, usadoPor: null, usadoEm: null, criadoEm: new Date(0), ...extra }))

// O lote que o app envia para virar personal (lib/dayon-cloud.js tornarPersonal).
function promover(db, uid, codigo) {
  const b = writeBatch(db)
  b.update(doc(db, 'convitesPersonal', codigo), { ativo: false, usadoPor: uid, usadoEm: serverTimestamp() })
  b.update(doc(db, 'users', uid), { papel: 'personal', conviteUsado: codigo, atualizadoEm: serverTimestamp() })
  return b.commit()
}
// O lote que o aluno envia para se ligar a um personal (lib/dayon-cloud.js ligarAoPersonal).
function ligar(db, alunoId, personalId, codigo) {
  const b = writeBatch(db)
  b.update(doc(db, 'convitesAluno', codigo), { ativo: false, usadoPor: alunoId, usadoEm: serverTimestamp() })
  b.set(doc(db, 'vinculos', `${personalId}_${alunoId}`), { personalId, alunoId, status: 'ativo', conviteUsado: codigo, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() })
  return b.commit()
}

describe('sem login', () => {
  it('não lê nem escreve nada', async () => {
    await baseUsers()
    const db = anon()
    await assertFails(getDoc(doc(db, 'users', ALUNA)))
    await assertFails(getDoc(doc(db, `users/${ALUNA}/plan/atual`)))
    await assertFails(getDocs(collection(db, `users/${ALUNA}/workouts`)))
    await assertFails(setDoc(doc(db, `users/${ALUNA}/plan/atual`), dataDoc(ALUNA)))
    await assertFails(getDoc(doc(db, 'convitesPersonal', 'qualquer')))
    await assertFails(setDoc(doc(db, 'users', 'novo'), perfil('novo')))
  })
})

describe('perfil', () => {
  it('conta nova nasce aluno; não nasce personal', async () => {
    const db = as('novo')
    await assertFails(setDoc(doc(db, 'users', 'novo'), { nome: 'N', papel: 'personal', email: email('novo'), criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() }))
    await assertSucceeds(setDoc(doc(db, 'users', 'novo'), { nome: 'N', papel: 'aluno', email: email('novo'), criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() }))
  })
  it('ninguém cria o perfil de outra pessoa nem lista usuários', async () => {
    await baseUsers()
    await assertFails(setDoc(doc(as(ESTRANHO), 'users', 'outro'), { nome: 'X', papel: 'aluno', email: email(ESTRANHO), criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() }))
    await assertFails(getDocs(collection(as(P1), 'users')))
    await assertFails(getDoc(doc(as(ESTRANHO), 'users', ALUNA)))
  })
  it('o aluno muda o próprio nome, mas não o papel sozinho', async () => {
    await baseUsers()
    const db = as(ALUNA)
    await assertSucceeds(updateDoc(doc(db, 'users', ALUNA), { nome: 'Ana', atualizadoEm: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'users', ALUNA), { papel: 'personal', atualizadoEm: serverTimestamp() }))
    await assertFails(updateDoc(doc(db, 'users', ALUNA), { papel: 'personal', conviteUsado: 'inexistente', atualizadoEm: serverTimestamp() }))
  })
})

describe('aluno: os próprios dados', () => {
  it('lê e escreve o próprio plano e os próprios treinos', async () => {
    await baseUsers()
    const db = as(ALUNA)
    await assertSucceeds(getDoc(doc(db, `users/${ALUNA}/plan/atual`)))
    await assertSucceeds(setDoc(doc(db, `users/${ALUNA}/plan/atual`), dataDoc(ALUNA)))
    await assertSucceeds(getDocs(collection(db, `users/${ALUNA}/workouts`)))
    await assertSucceeds(setDoc(doc(db, `users/${ALUNA}/workouts/w2`), dataDoc(ALUNA, { d: '2026-11-02' })))
    await assertSucceeds(deleteDoc(doc(db, `users/${ALUNA}/workouts/w2`)))
    await assertSucceeds(setDoc(doc(db, `users/${ALUNA}/estado/atual`), dataDoc(ALUNA)))
  })
  it('não lê nem escreve os de outro aluno', async () => {
    await baseUsers()
    const db = as(ALUNA)
    await assertFails(getDoc(doc(db, `users/${ALUNO2}/plan/atual`)))
    await assertFails(getDocs(collection(db, `users/${ALUNO2}/workouts`)))
    await assertFails(setDoc(doc(db, `users/${ALUNO2}/workouts/w3`), dataDoc(ALUNA, { d: '2026-11-02' })))
    await assertFails(getDoc(doc(db, `users/${ALUNO2}/estado/atual`)))
  })
  it('o formato do documento é conferido (campos, autor, data do servidor)', async () => {
    await baseUsers()
    const db = as(ALUNA)
    await assertFails(setDoc(doc(db, `users/${ALUNA}/plan/atual`), { ...dataDoc(ALUNA), extra: 1 }))
    await assertFails(setDoc(doc(db, `users/${ALUNA}/plan/atual`), dataDoc(ALUNA, { por: ALUNO2 })))
    await assertFails(setDoc(doc(db, `users/${ALUNA}/plan/atual`), dataDoc(ALUNA, { atualizadoEm: new Date(0) })))
  })
})

describe('promoção a personal', () => {
  it('só no lote com um convite válido', async () => {
    await baseUsers()
    await convitePersonal('CODIGO-VALIDO-123')
    await assertSucceeds(promover(as(ALUNA), ALUNA, 'CODIGO-VALIDO-123'))
    // Lê o perfil com as regras ligadas (a aluna pode ler o próprio doc). Não usamos o
    // retorno de withSecurityRulesDisabled, que nesta versão da lib não devolve o valor do callback.
    const snap = (await getDoc(doc(as(ALUNA), 'users', ALUNA))).data()
    if (!snap || snap.papel !== 'personal') throw new Error('não virou personal')
  })
  it('o convite não serve duas vezes', async () => {
    await baseUsers()
    await convitePersonal('CODIGO-UNICO-456')
    await assertSucceeds(promover(as(ALUNA), ALUNA, 'CODIGO-UNICO-456'))
    await assertFails(promover(as(ALUNO2), ALUNO2, 'CODIGO-UNICO-456'))
  })
  it('convite inexistente, já usado ou desativado falha', async () => {
    await baseUsers()
    await convitePersonal('JA-USADO-0001', { ativo: false, usadoPor: ESTRANHO, usadoEm: new Date(0) })
    await convitePersonal('DESATIVADO-01', { ativo: false })
    await assertFails(promover(as(ALUNA), ALUNA, 'NAO-EXISTE-000'))
    await assertFails(promover(as(ALUNA), ALUNA, 'JA-USADO-0001'))
    await assertFails(promover(as(ALUNA), ALUNA, 'DESATIVADO-01'))
  })
  it('não dá para gastar o convite sem virar personal, nem em nome de outra pessoa', async () => {
    await baseUsers()
    await convitePersonal('CODIGO-SOLTO-789')
    const db = as(ALUNA)
    await assertFails(updateDoc(doc(db, 'convitesPersonal', 'CODIGO-SOLTO-789'), { ativo: false, usadoPor: ALUNA, usadoEm: serverTimestamp() }))
    const b = writeBatch(db)
    b.update(doc(db, 'convitesPersonal', 'CODIGO-SOLTO-789'), { ativo: false, usadoPor: ALUNO2, usadoEm: serverTimestamp() })
    b.update(doc(db, 'users', ALUNO2), { papel: 'personal', conviteUsado: 'CODIGO-SOLTO-789', atualizadoEm: serverTimestamp() })
    await assertFails(b.commit())
  })
  it('ninguém cria, lista ou apaga convites de personal pelo app; ler um código é permitido', async () => {
    await baseUsers()
    await convitePersonal('CODIGO-LEITURA-1')
    const db = as(P1)
    await assertFails(setDoc(doc(db, 'convitesPersonal', 'MEU-PROPRIO-CODIGO'), { ativo: true, usadoPor: null, usadoEm: null }))
    await assertFails(getDocs(collection(db, 'convitesPersonal')))
    await assertFails(deleteDoc(doc(db, 'convitesPersonal', 'CODIGO-LEITURA-1')))
    await assertSucceeds(getDoc(doc(db, 'convitesPersonal', 'CODIGO-LEITURA-1')))
  })
  // QA 11/11/2026: o código real tem maiúsculas, minúsculas, '-' e '_' (24 caracteres) e o doc foi
  // criado à mão no Console só com ativo/usadoPor/usadoEm. O lote do app (o mesmo payload) passa;
  // o mesmo código em MAIÚSCULAS é outro doc, que não existe, e falha (era o defeito do app).
  it('código com maiúsculas e minúsculas, criado no Console: o lote do app passa', async () => {
    await baseUsers()
    const codigo = 'Ab3x-Kq_9zPw-LmN8-Rt5y-Vu'
    await seed(db => setDoc(doc(db, 'convitesPersonal', codigo), { ativo: true, usadoPor: null, usadoEm: null }))
    await assertFails(promover(as(ALUNA), ALUNA, codigo.toUpperCase()))
    await assertSucceeds(promover(as(ALUNA), ALUNA, codigo))
    const u = await getDoc(doc(as(ALUNA), 'users', ALUNA))
    assert.equal(u.data().papel, 'personal')
  })
  it('quem já é personal não reativa nem reaproveita um convite', async () => {
    await baseUsers()
    await convitePersonal('USADO-POR-P1-01', { ativo: false, usadoPor: P1, usadoEm: new Date(0) })
    await assertFails(updateDoc(doc(as(P1), 'convitesPersonal', 'USADO-POR-P1-01'), { ativo: true, usadoPor: null, usadoEm: null }))
  })
})

describe('vínculo personal <-> aluno', () => {
  it('só personal cria convite de aluno, em nome próprio', async () => {
    await baseUsers()
    const novo = (uid, personalId = uid) => setDoc(doc(as(uid), 'convitesAluno', 'CONVITE-' + uid + '-01'),
      { personalId, personalNome: 'P', ativo: true, usadoPor: null, usadoEm: null, criadoEm: serverTimestamp() })
    await assertSucceeds(novo(P1))
    await assertFails(novo(ALUNA))
    await assertFails(novo(P2, P1))
  })
  it('o aluno resgata o convite e o vínculo nasce ativo; o convite não serve de novo', async () => {
    await baseUsers()
    await conviteAluno('CONVITE-P1-AAAA', P1)
    await assertSucceeds(ligar(as(ALUNA), ALUNA, P1, 'CONVITE-P1-AAAA'))
    await assertFails(ligar(as(ALUNO2), ALUNO2, P1, 'CONVITE-P1-AAAA'))
  })
  it('não cria vínculo sem convite, nem com convite de outro personal', async () => {
    await baseUsers()
    await conviteAluno('CONVITE-P2-BBBB', P2)
    const db = as(ALUNA)
    await assertFails(setDoc(doc(db, 'vinculos', `${P1}_${ALUNA}`), { personalId: P1, alunoId: ALUNA, status: 'ativo', conviteUsado: 'NADA', criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() }))
    await assertFails(ligar(db, ALUNA, P1, 'CONVITE-P2-BBBB'))
  })
  it('o personal não cria vínculo sozinho, e aluno não vira personal por vínculo', async () => {
    await baseUsers()
    await assertFails(setDoc(doc(as(P1), 'vinculos', `${P1}_${ALUNA}`), { personalId: P1, alunoId: ALUNA, status: 'ativo', conviteUsado: 'X', criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() }))
    await conviteAluno('CONVITE-P1-CCCC', P1)
    await assertSucceeds(ligar(as(ALUNA), ALUNA, P1, 'CONVITE-P1-CCCC'))
    await assertFails(updateDoc(doc(as(ALUNA), 'users', ALUNA), { papel: 'personal', atualizadoEm: serverTimestamp() }))
  })
  it('listar vínculos só filtrando pelo próprio uid', async () => {
    await baseUsers()
    await vinculo(P1, ALUNA)
    await vinculo(P2, ALUNO2)
    await assertSucceeds(getDocs(query(collection(as(P1), 'vinculos'), where('personalId', '==', P1))))
    await assertSucceeds(getDocs(query(collection(as(ALUNA), 'vinculos'), where('alunoId', '==', ALUNA))))
    await assertFails(getDocs(collection(as(P1), 'vinculos')))
    await assertFails(getDocs(query(collection(as(P1), 'vinculos'), where('personalId', '==', P2))))
  })
  it('encerrar: o aluno ou o personal; reativar só com convite novo', async () => {
    await baseUsers()
    await vinculo(P1, ALUNA)
    await assertSucceeds(updateDoc(doc(as(ALUNA), 'vinculos', `${P1}_${ALUNA}`), { status: 'encerrado', atualizadoEm: serverTimestamp() }))
    await assertFails(getDoc(doc(as(P1), `users/${ALUNA}/plan/atual`)))
    await assertFails(updateDoc(doc(as(ALUNA), 'vinculos', `${P1}_${ALUNA}`), { status: 'ativo', atualizadoEm: serverTimestamp() }))
    await conviteAluno('CONVITE-P1-DDDD', P1)
    const db = as(ALUNA)
    const b = writeBatch(db)
    b.update(doc(db, 'convitesAluno', 'CONVITE-P1-DDDD'), { ativo: false, usadoPor: ALUNA, usadoEm: serverTimestamp() })
    b.update(doc(db, 'vinculos', `${P1}_${ALUNA}`), { status: 'ativo', conviteUsado: 'CONVITE-P1-DDDD', atualizadoEm: serverTimestamp() })
    await assertSucceeds(b.commit())
    await assertSucceeds(getDoc(doc(as(P1), `users/${ALUNA}/plan/atual`)))
  })
})

describe('personal com vínculo ativo', () => {
  it('lê os treinos e lê/escreve o plano do aluno', async () => {
    await baseUsers()
    await vinculo(P1, ALUNA)
    const db = as(P1)
    await assertSucceeds(getDocs(collection(db, `users/${ALUNA}/workouts`)))
    await assertSucceeds(getDoc(doc(db, `users/${ALUNA}/workouts/w1`)))
    await assertSucceeds(getDoc(doc(db, `users/${ALUNA}/plan/atual`)))
    await assertSucceeds(setDoc(doc(db, `users/${ALUNA}/plan/atual`), dataDoc(P1)))
    await assertSucceeds(getDoc(doc(db, 'users', ALUNA)))
  })
  it('não escreve o histórico nem o perfil do aluno, e não lê o resto do perfil', async () => {
    await baseUsers()
    await vinculo(P1, ALUNA)
    const db = as(P1)
    await assertFails(setDoc(doc(db, `users/${ALUNA}/workouts/w5`), dataDoc(P1, { d: '2026-11-05' })))
    await assertFails(deleteDoc(doc(db, `users/${ALUNA}/workouts/w1`)))
    await assertFails(updateDoc(doc(db, 'users', ALUNA), { nome: 'Outro', atualizadoEm: serverTimestamp() }))
    await assertFails(deleteDoc(doc(db, `users/${ALUNA}/plan/atual`)))
    await assertFails(getDoc(doc(db, `users/${ALUNA}/estado/atual`)))
  })
  it('sem vínculo (ou com vínculo pendente/encerrado) não lê nada', async () => {
    await baseUsers()
    await vinculo(P2, ALUNA, 'pendente')
    await vinculo(P1, ALUNO2, 'encerrado')
    await assertFails(getDoc(doc(as(P2), `users/${ALUNA}/plan/atual`)))
    await assertFails(getDocs(collection(as(P2), `users/${ALUNA}/workouts`)))
    await assertFails(getDoc(doc(as(P1), `users/${ALUNO2}/plan/atual`)))
    await assertFails(getDoc(doc(as(P1), `users/${ALUNA}/plan/atual`)))
  })
  it('dois personais: cada um só acessa o seu aluno', async () => {
    await baseUsers()
    await vinculo(P1, ALUNA)
    await vinculo(P2, ALUNO2)
    await assertSucceeds(getDoc(doc(as(P1), `users/${ALUNA}/plan/atual`)))
    await assertSucceeds(getDoc(doc(as(P2), `users/${ALUNO2}/plan/atual`)))
    await assertFails(getDoc(doc(as(P1), `users/${ALUNO2}/plan/atual`)))
    await assertFails(getDocs(collection(as(P1), `users/${ALUNO2}/workouts`)))
    await assertFails(getDoc(doc(as(P2), `users/${ALUNA}/plan/atual`)))
    await assertFails(setDoc(doc(as(P2), `users/${ALUNA}/plan/atual`), dataDoc(P2)))
  })
  it('um aluno com vínculo não ganha acesso aos dados de outro aluno do mesmo personal', async () => {
    await baseUsers()
    await vinculo(P1, ALUNA)
    await vinculo(P1, ALUNO2)
    await assertFails(getDoc(doc(as(ALUNA), `users/${ALUNO2}/plan/atual`)))
    await assertSucceeds(getDoc(doc(as(ALUNA), 'users', P1)))
  })
  it('alguém que só diz ser personal (sem papel no perfil) não acessa', async () => {
    await baseUsers()
    await vinculo(ESTRANHO, ALUNA)   // vínculo forjado no Console, mas o perfil é de aluno
    await assertFails(getDoc(doc(as(ESTRANHO), `users/${ALUNA}/plan/atual`)))
  })
})
