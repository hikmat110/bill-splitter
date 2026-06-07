import { session } from 'grammy'
import type { SessionFlavor } from 'grammy'

export interface WizardItem {
  name: string
  price: bigint
  shareContactIds: string[]
}

export interface SessionData {
  mainMessageId?: number

  contact_wizard?: {
    step: 'awaiting_contact_source' | 'awaiting_name' | 'awaiting_phone' | 'awaiting_contact_share' | 'awaiting_username'
    display_name?: string
    wizardMessageId?: number
  }

  // NOTE: bigint fields are safe here because session is in-memory.
  // If session storage moves to Redis/Postgres, add a BigInt-aware serializer.
  bill_wizard?: {
    step:
      | 'awaiting_title'
      | 'awaiting_participants'
      | 'awaiting_item_name'
      | 'awaiting_item_price'
      | 'awaiting_item_shares'
      | 'awaiting_service'
      | 'awaiting_service_custom'
      | 'awaiting_tip'
      | 'awaiting_tip_custom'
      | 'review'
    wizardMessageId?: number
    title?: string
    participantContactIds: string[]
    items: WizardItem[]
    currentItem?: Partial<WizardItem>
    servicePct: number
    serviceFixed: bigint
    tip: bigint
  }

  dispute_wizard?: {
    step: 'awaiting_reason'
    participantId: string
  }

  settings_wizard?: {
    step: 'awaiting_card_number'
    wizardMessageId?: number
  }
}

export type SessionContext = SessionFlavor<SessionData>

export function initial(): SessionData {
  return {}
}

export const sessionMiddleware = session({ initial })
