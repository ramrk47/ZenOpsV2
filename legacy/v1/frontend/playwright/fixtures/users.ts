export type E2EUser = {
  role: 'admin' | 'ops' | 'finance' | 'hr' | 'assistant' | 'field' | 'associate'
  email: string
  password: string
}

export const USERS: Record<E2EUser['role'], E2EUser> = {
  admin: { role: 'admin', email: 'admin@zenops.local', password: 'password' },
  ops: { role: 'ops', email: 'ops@zenops.local', password: 'password' },
  finance: { role: 'finance', email: 'finance@zenops.local', password: 'password' },
  hr: { role: 'hr', email: 'hr@zenops.local', password: 'password' },
  assistant: { role: 'assistant', email: 'assistant@zenops.local', password: 'password' },
  field: { role: 'field', email: 'field@zenops.local', password: 'password' },
  associate: { role: 'associate', email: 'associate@zenops.local', password: 'password' },
}

export function buildOnboardingAssociate(): E2EUser {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    role: 'associate',
    email: `auto-associate+${suffix}@zenops.local`,
    password: 'password',
  }
}
