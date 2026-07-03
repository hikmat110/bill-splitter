import { session } from 'grammy'
import type { SessionFlavor } from 'grammy'

export interface WizardItem {
  name: string
  price: number // real 2-decimal som
  shareContactIds: string[]
}

export interface SessionData {
  mainMessageId?: number

  contact_wizard?: {
    step: 'awaiting_contact_source' | 'awaiting_name' | 'awaiting_phone' | 'awaiting_users_share' | 'awaiting_username'
    display_name?: string
    wizardMessageId?: number
    /** Carrier message holding the request_users reply keyboard, deleted after selection. */
    pickerMessageId?: number
  }

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
      | 'awaiting_tip_payer'
      | 'awaiting_receipt_photo'
      | 'review'
    wizardMessageId?: number
    title?: string
    participantContactIds: string[]
    items: WizardItem[]
    currentItem?: Partial<WizardItem>
    servicePct: number
    serviceFixed: number
    tip: number
    /** Contact who paid the tip; undefined = creator (default). */
    tipPaidByContactId?: string
    /** Optional main receipt/cheque photo, set in the awaiting_receipt_photo step. */
    receiptAttachmentId?: string
    receiptMime?: string
  }

  mark_paid_wizard?: {
    step: 'awaiting_proof'
    participantId: string
    promptMessageId?: number
  }

  dispute_wizard?: {
    step: 'awaiting_reason'
    participantId: string
  }

  settings_wizard?: {
    step: 'awaiting_card_number' | 'awaiting_card_label'
    wizardMessageId?: number
    /** Card being renamed (awaiting_card_label). */
    editingCardId?: string
    /** Registration onboarding: after save/skip, go to main menu, not settings. */
    afterRegistration?: boolean
  }
}

export type SessionContext = SessionFlavor<SessionData>

export function initial(): SessionData {
  return {}
}

export const sessionMiddleware = session({ initial })
