export type E2EUser = {
  role: 'admin' | 'ops' | 'finance' | 'hr' | 'assistant' | 'field' | 'associate'
  email: string
  password: string
}

export const USERS: Record<E2EUser['role'], E2EUser> = {
  admin: { role: 'admin', email: 'admin@maulya.local', password: 'password' },
  ops: { role: 'ops', email: 'ops@maulya.local', password: 'password' },
  finance: { role: 'finance', email: 'finance@maulya.local', password: 'password' },
  hr: { role: 'hr', email: 'hr@maulya.local', password: 'password' },
  assistant: { role: 'assistant', email: 'assistant@maulya.local', password: 'password' },
  field: { role: 'field', email: 'field@maulya.local', password: 'password' },
  associate: { role: 'associate', email: 'associate@maulya.local', password: 'password' },
}

export function buildOnboardingAssociate(): E2EUser {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    role: 'associate',
    email: `auto-associate+${suffix}@maulya.local`,
    password: 'password',
  }
}
