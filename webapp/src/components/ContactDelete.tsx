import { useState } from 'react'
import { useToast } from './Toast'
import { api, ApiError } from '../lib/api'
import { haptic } from '../lib/telegram'
import { prettyDate } from '../lib/date'
import { useT } from '../i18n'
import type { Person } from '../lib/draft'
import type { BlockingBill } from '../lib/types'

export interface BlockedDelete {
  person: Person
  bills: BlockingBill[]
}

/**
 * The shared contact-delete flow: confirm → DELETE → on 409, surface the
 * referencing bills so the user can force a soft-delete (the contact is hidden
 * from their list but keeps rendering inside those bills). Used by both the
 * people sheet and the Profile friends list so the semantics can't drift.
 */
export function useContactDelete(onDeleted: (contactId: string) => Promise<void>) {
  const { t } = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState<BlockedDelete | null>(null)

  const deleteContact = async (person: Person, force: boolean) => {
    setBusy(true)
    try {
      await api.deleteContact(person.id, { force })
      haptic('success')
      toast(t('people.deleted'), 'ti-trash')
      setBlocked(null)
      await onDeleted(person.id)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const bills = (e.data as { blockingBills?: BlockingBill[] })?.blockingBills ?? []
        setBlocked({ person, bills })
      } else {
        toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
      }
    } finally {
      setBusy(false)
    }
  }

  const requestDelete = (person: Person) => {
    if (!window.confirm(t('people.delete_confirm', { name: person.name }))) return
    void deleteContact(person, false)
  }

  const forceDelete = () => {
    if (blocked) void deleteContact(blocked.person, true)
  }

  return { busy, blocked, cancelBlocked: () => setBlocked(null), requestDelete, forceDelete }
}

/** The "used in these bills" confirmation body shown when a delete was blocked. */
export function BlockingBillsPanel({
  blocked,
  busy,
  onCancel,
  onForce,
}: {
  blocked: BlockedDelete
  busy: boolean
  onCancel: () => void
  onForce: () => void
}) {
  const { t, lang } = useT()
  return (
    <div className="col" style={{ gap: 14, paddingBottom: 6 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>
        {t('people.blocked_title', { name: blocked.person.name })}
      </div>
      <div className="col" style={{ gap: 6 }}>
        {blocked.bills.slice(0, 10).map((b) => (
          <div key={b.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {b.title}
            </span>
            <span className="muted3" style={{ fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>
              {prettyDate(t, lang, b.createdAt)}
            </span>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.5 }}>
        {t('people.blocked_hint')}
      </div>
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-soft" style={{ flex: 1 }} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={onForce}>
          <i className="ti ti-trash" /> {t('people.delete_anyway')}
        </button>
      </div>
    </div>
  )
}
