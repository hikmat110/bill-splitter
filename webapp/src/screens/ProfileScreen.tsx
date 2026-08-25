import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Sheet } from '../components/Sheet'
import { SecTitle } from '../components/common'
import { useToast } from '../components/Toast'
import { useContactDelete, BlockingBillsPanel } from '../components/ContactDelete'
import { cardLabel, formatCard } from '../lib/cards'
import { copyWithToast } from '../lib/clipboard'
import { BUILD, VERSION_LABEL } from '../lib/version'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useT } from '../i18n'
import type { Me, UserCard } from '../lib/types'
import type { Person } from '../lib/draft'

const LANGS: { value: 'uz' | 'ru' | 'en'; label: string }[] = [
  // Endonyms on purpose — a language name should be readable in that language.
  { value: 'uz', label: "O'zbek" },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
]

export function ProfileScreen({
  me,
  contacts,
  onMe,
  onRefreshMe,
  onAddCard,
  onCardDeleted,
  onOpenAddContact,
  onContactDeleted,
  onOpenFeedbackAdmin,
}: {
  me: Me
  /** The user's contacts (self excluded — the header covers "you"). */
  contacts: Person[]
  onMe: (me: Me) => void
  onRefreshMe: () => Promise<void>
  onAddCard: (number: string) => Promise<UserCard>
  onCardDeleted: (cardId: string) => Promise<void>
  onOpenAddContact: () => void
  onContactDeleted: (contactId: string) => Promise<void>
  onOpenFeedbackAdmin: () => void
}) {
  const { t, lang, setLang } = useT()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const [addingCard, setAddingCard] = useState(false)
  const [cardInput, setCardInput] = useState('')

  const contactDelete = useContactDelete(onContactDeleted)

  const fullName = [me.firstName, me.lastName].filter(Boolean).join(' ')

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string, icon: string) => {
    setBusy(key)
    try {
      await fn()
      haptic('success')
      toast(okMsg, icon)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setBusy(null)
    }
  }

  // ── cards ───────────────────────────────────────────────────────────────────

  const setDefault = (c: UserCard) =>
    run(
      c.id,
      async () => {
        await api.updateCard(c.id, { isDefault: true })
        await onRefreshMe()
      },
      t('profile.default_set'),
      'ti-star'
    )

  const rename = (c: UserCard) => {
    const input = window.prompt(t('profile.rename_prompt'), c.label ?? '')
    if (input === null) return // cancelled
    const label = input.trim() ? input.trim().slice(0, 50) : null // empty clears
    void run(
      c.id,
      async () => {
        await api.updateCard(c.id, { label })
        await onRefreshMe()
      },
      t('profile.card_renamed'),
      'ti-pencil'
    )
  }

  const removeCard = (c: UserCard) => {
    if (!window.confirm(t('profile.delete_card_confirm', { label: cardLabel(c) }))) return
    void run(
      c.id,
      async () => {
        await api.deleteCard(c.id)
        await onCardDeleted(c.id)
      },
      t('profile.card_deleted'),
      'ti-trash'
    )
  }

  const submitCard = async () => {
    const digits = cardInput.replace(/\D/g, '')
    if (digits.length !== 16) {
      toast(t('split.card_invalid'), 'ti-alert-circle')
      return
    }
    setBusy('add')
    try {
      await onAddCard(digits)
      setAddingCard(false)
      setCardInput('')
      haptic('success')
      toast(t('split.card_added'), 'ti-credit-card')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setBusy(null)
    }
  }

  // ── language ────────────────────────────────────────────────────────────────

  const changeLanguage = (code: 'uz' | 'ru' | 'en') => {
    if (code === lang || busy === 'lang') return
    void run(
      'lang',
      async () => {
        const updated = await api.updateMe({ languageCode: code })
        setLang(code) // flips the whole UI (and the money formatter) instantly
        onMe(updated)
      },
      t('profile.language_set'),
      'ti-language'
    )
  }

  return (
    <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
      {/* who you are — display-only, synced from Telegram / registration */}
      <div className="card pop" style={{ marginBottom: 18, padding: 'calc(16px * var(--dens))' }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar id={me.selfContactId} name={fullName || t('common.you')} size={56} />
          <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <span style={{ fontWeight: 800, fontSize: 17.5, letterSpacing: '-.3px' }}>
              {fullName || t('common.you')}
            </span>
            {me.username && (
              <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                @{me.username}
              </span>
            )}
            <span className="muted3" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {me.phone}
            </span>
          </div>
        </div>
      </div>

      {/* cards */}
      <SecTitle>{t('profile.cards')}</SecTitle>
      <div className="card" style={{ marginBottom: 18, padding: 'calc(13px * var(--dens))' }}>
        <div className="col" style={{ gap: 4 }}>
          {me.cards.map((c) => (
            <div key={c.id} className="row" style={{ gap: 10, padding: '6px 0' }}>
              <i className="ti ti-credit-card" style={{ fontSize: 20, color: 'var(--accent)', flexShrink: 0 }} />
              <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <div className="row" style={{ gap: 7 }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {cardLabel(c)}
                  </span>
                  {c.isDefault && (
                    <span className="pill pill-acc" style={{ fontSize: 10.5, padding: '1px 7px' }}>
                      {t('profile.default_pill')}
                    </span>
                  )}
                </div>
                <span className="muted tnum" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {formatCard(c.number)}
                </span>
              </div>
              <div className="row" style={{ gap: 2, flexShrink: 0 }}>
                {!c.isDefault && (
                  <button
                    className="icon-btn"
                    disabled={busy === c.id}
                    onClick={() => setDefault(c)}
                    title={t('profile.set_default')}
                    style={{ color: 'var(--text-3)' }}
                  >
                    <i className="ti ti-star" style={{ fontSize: 17 }} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  disabled={busy === c.id}
                  onClick={() => rename(c)}
                  title={t('profile.rename')}
                  style={{ color: 'var(--text-3)' }}
                >
                  <i className="ti ti-pencil" style={{ fontSize: 17 }} />
                </button>
                <button
                  className="icon-btn"
                  disabled={busy === c.id}
                  onClick={() => removeCard(c)}
                  title={t('profile.delete_card_confirm', { label: cardLabel(c) })}
                  style={{ color: 'var(--text-3)' }}
                >
                  <i className="ti ti-trash" style={{ fontSize: 17 }} />
                </button>
              </div>
            </div>
          ))}
          {me.cards.length === 0 && (
            <div className="muted" style={{ fontSize: 13, fontWeight: 600, padding: '4px 0 8px' }}>
              {t('profile.no_cards')}
            </div>
          )}

          {addingCard ? (
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <input
                className="inp"
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder={t('split.card_number_placeholder')}
                value={cardInput}
                onChange={(e) => setCardInput(e.target.value)}
                style={{ flex: 1, fontWeight: 700, fontSize: 15, padding: '8px 10px' }}
              />
              <button
                className="btn btn-sm btn-primary"
                disabled={busy === 'add'}
                onClick={() => void submitCard()}
              >
                <i className={'ti ' + (busy === 'add' ? 'ti-loader-2' : 'ti-check')} />
              </button>
            </div>
          ) : (
            <button className="btn btn-soft btn-block" style={{ marginTop: 6 }} onClick={() => setAddingCard(true)}>
              <i className="ti ti-plus" /> {t('split.add_card')}
            </button>
          )}
        </div>
      </div>

      {/* friends */}
      <SecTitle
        action={
          <button className="btn btn-sm btn-soft" onClick={onOpenAddContact}>
            <i className="ti ti-plus" /> {t('profile.add_friend')}
          </button>
        }
      >
        {t('profile.friends')}
      </SecTitle>
      <div className="card" style={{ marginBottom: 18, padding: 'calc(13px * var(--dens))' }}>
        <div className="col" style={{ gap: 4 }}>
          {contacts.map((p) => (
            <div key={p.id} className="row" style={{ gap: 10, padding: '6px 0' }}>
              <Avatar id={p.id} name={p.name} size={38} />
              <div className="row" style={{ flex: 1, minWidth: 0, gap: 7 }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.name}
                </span>
                {p.linkedUserId && (
                  <span className="pill pill-acc" style={{ fontSize: 10.5, padding: '1px 7px', flexShrink: 0 }}>
                    <i className="ti ti-brand-telegram" style={{ fontSize: 11 }} /> {t('profile.linked_pill')}
                  </span>
                )}
              </div>
              <button
                className="icon-btn"
                disabled={contactDelete.busy}
                onClick={() => contactDelete.requestDelete(p)}
                aria-label={t('people.delete_confirm', { name: p.name })}
                style={{ color: 'var(--text-3)', flexShrink: 0 }}
              >
                <i className="ti ti-trash" style={{ fontSize: 17 }} />
              </button>
            </div>
          ))}
          {contacts.length === 0 && (
            <div className="muted" style={{ fontSize: 13, fontWeight: 600, padding: '4px 0' }}>
              {t('people.no_contacts')}
            </div>
          )}
        </div>
      </div>

      {/* language — persists to the account, so the bot switches too */}
      <SecTitle>{t('profile.language')}</SecTitle>
      <div className="card" style={{ padding: 'calc(13px * var(--dens))' }}>
        <div className="seg">
          {LANGS.map((l) => (
            <button
              key={l.value}
              className={lang === l.value ? 'on' : ''}
              disabled={busy === 'lang'}
              onClick={() => changeLanguage(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* admin-only feedback inbox (me.isAdmin mirrors the server-side guard) */}
      {me.isAdmin && (
        <button
          className="btn btn-block"
          style={{ marginTop: 18 }}
          onClick={onOpenFeedbackAdmin}
        >
          <i className="ti ti-message-report" /> {t('feedback.admin_row')}
        </button>
      )}

      {/* build identity — tap to copy, so a bug report can quote it exactly */}
      <button
        className="muted3"
        onClick={() =>
          copyWithToast(BUILD.buildId, toast, {
            copied: t('share.copied'),
            manual: t('share.copy_failed'),
          })
        }
        style={{
          display: 'block',
          width: '100%',
          background: 'none',
          border: 0,
          padding: '18px 0 4px',
          textAlign: 'center',
          fontFamily: 'inherit',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {VERSION_LABEL}
      </button>

      {/* blocked contact delete → force soft-delete confirmation */}
      <Sheet
        open={contactDelete.blocked !== null}
        onClose={contactDelete.cancelBlocked}
        title={t('profile.friends')}
      >
        {contactDelete.blocked && (
          <BlockingBillsPanel
            blocked={contactDelete.blocked}
            busy={contactDelete.busy}
            onCancel={contactDelete.cancelBlocked}
            onForce={contactDelete.forceDelete}
          />
        )}
      </Sheet>
    </div>
  )
}
