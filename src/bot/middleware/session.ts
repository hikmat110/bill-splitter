import { session } from 'grammy'
import type { SessionFlavor } from 'grammy'

export interface SessionData {
  // Wizard state will be added here in future iterations
  step?: string
}

export type SessionContext = SessionFlavor<SessionData>

export function initial(): SessionData {
  return {}
}

export const sessionMiddleware = session({ initial })
