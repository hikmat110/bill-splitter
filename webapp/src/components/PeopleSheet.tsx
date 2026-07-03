import { useState } from 'react'
import { Avatar } from './Avatar'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { api, ApiError } from '../lib/api'
import { haptic } from '../lib/telegram'
import { prettyDate } from '../lib/date'
import { useT } from '../i18n'
import type { Person } from '../lib/draft'
import type { BlockingBill } from '../lib/types'

export function PeopleSheet({
  open,
  onClose,
  people,
  selected,
  selfContactId,
  onToggle,
  onOpenAdd,
  onDeleted,
}: {
  open: boolean
  onClose: () => void
  people: Person[]
  selected: string[]
  /** The "You" contact — never deletable. */
  selfContactId: string | null
  onToggle: (id: string) => void
  onOpenAdd: () => void
  onDeleted: (contactId: string) => Promise<void>
}) {
  const { t, lang } = useT()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // A delete blocked by bill references — confirm soft-delete in-sheet.
  const [blocked, setBlocked] = useState<{ person: Person; bills: BlockingBill[] } | null>(null)

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

  const onDeleteTap = (person: Person) => {
    if (!window.confirm(t('people.delete_confirm', { name: person.name }))) return
    void deleteContact(person, false)
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('people.title')}>
      {blocked ? (
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
            <button className="btn btn-soft" style={{ flex: 1 }} onClick={() => setBlocked(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => void deleteContact(blocked.person, true)}
            >
              <i className="ti ti-trash" /> {t('people.delete_anyway')}
            </button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 14, paddingBottom: 6 }}>
          <button className="btn btn-soft btn-block" onClick={onOpenAdd}>
            <i className="ti ti-plus" style={{ marginRight: 8 }} />
            {t('people.add_contact')}
          </button>

          <div className="col" style={{ gap: 4 }}>
            {people.map((p) => {
              const on = selected.includes(p.id)
              const deletable = p.id !== selfContactId
              return (
                <div key={p.id} className="row" style={{ gap: 4 }}>
                  <button
                    onClick={() => onToggle(p.id)}
                    className="row"
                    style={{
                      gap: 12,
                      padding: '9px 10px',
                      borderRadius: 'var(--r-sm)',
                      border: 'none',
                      cursor: 'pointer',
                      flex: 1,
                      minWidth: 0,
                      background: on ? 'var(--accent-soft)' : 'transparent',
                      textAlign: 'left',
                    }}
                  >
                    <Avatar id={p.id} name={p.name} size={40} />
                    <div className="col" style={{ flex: 1 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: 14.5,
                          color: on ? 'var(--accent-text)' : 'var(--text)',
                        }}
                      >
                        {p.name}
                      </span>
                    </div>
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 999,
                        flexShrink: 0,
                        border: on ? 'none' : '2px solid var(--border-2)',
                        background: on ? 'var(--accent)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {on && <i className="ti ti-check" style={{ fontSize: 14, color: 'var(--on-accent)' }} />}
                    </div>
                  </button>
                  {deletable && (
                    <button
                      className="icon-btn"
                      disabled={busy}
                      onClick={() => onDeleteTap(p)}
                      aria-label={t('people.delete_confirm', { name: p.name })}
                      style={{ color: 'var(--text-3)', flexShrink: 0 }}
                    >
                      <i className="ti ti-trash" style={{ fontSize: 17 }} />
                    </button>
                  )}
                </div>
              )
            })}
            {people.length === 0 && (
              <div className="muted" style={{ fontSize: 13, fontWeight: 600, padding: '8px 10px' }}>
                {t('people.no_contacts')}
              </div>
            )}
          </div>

          <button className="btn btn-primary btn-block btn-lg" onClick={onClose}>
            {t('people.done', { n: selected.length })}
          </button>
        </div>
      )}
    </Sheet>
  )
}
