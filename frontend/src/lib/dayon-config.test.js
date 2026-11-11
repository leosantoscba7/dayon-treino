import { describe, expect, it } from 'vitest'
import { firebaseConfig, dayonAvailable, SOURCE_CODE_URL } from './dayon-config.js'

const full = {
  VITE_FIREBASE_API_KEY: 'chave', VITE_FIREBASE_AUTH_DOMAIN: 'dayon---treino.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'dayon---treino', VITE_FIREBASE_APP_ID: '1:2:web:3',
}

describe('firebaseConfig', () => {
  it('reads the Vite variables', () => {
    expect(firebaseConfig(full)).toEqual({ apiKey: 'chave', authDomain: 'dayon---treino.firebaseapp.com', projectId: 'dayon---treino', appId: '1:2:web:3' })
    expect(dayonAvailable(full)).toBe(true)
  })
  it('names the public source repository the AGPL offer links to', () => {
    expect(SOURCE_CODE_URL).toBe('https://github.com/leosantoscba7/dayon-treino')
  })
  it('is null when any required value is missing or blank: the app stays local', () => {
    expect(firebaseConfig({})).toBeNull()
    expect(firebaseConfig({ ...full, VITE_FIREBASE_API_KEY: '  ' })).toBeNull()
    expect(firebaseConfig({ ...full, VITE_FIREBASE_APP_ID: undefined })).toBeNull()
    expect(dayonAvailable({ VITE_FIREBASE_PROJECT_ID: 'dayon---treino' })).toBe(false)
  })
})
