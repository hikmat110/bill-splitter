import { Avatar } from './Avatar'
import { Sheet } from './Sheet'
import { useContactDelete, BlockingBillsPanel } from './ContactDelete'
import { useT } from '../i18n'
import type { Person } from '../lib/draft'

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
  const { t } = useT()
  const { busy, blocked, cancelBlocked, requestDelete, forceDelete } = useContactDelete(onDeleted)

  return (
    <Sheet open={open} onClose={onClose} title={t('people.title')}>
      {blocked ? (
        <BlockingBillsPanel
          blocked={blocked}
          busy={busy}
          onCancel={cancelBlocked}
          onForce={forceDelete}
        />
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
                      onClick={() => requestDelete(p)}
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
