import { useState } from 'react'
import { Sheet } from './Sheet'
import { Segmented } from './common'
import { useToast } from './Toast'
import { useT } from '../i18n'
import { ApiError } from '../lib/api'
import { isInTelegram, openTelegramLink } from '../lib/telegram'
import type { UsernameAddResult } from '../lib/types'

type Tab = 'name' | 'username' | 'telegram'

export function AddContactSheet({
  open,
  onClose,
  botUsername,
  onAddByName,
  onAddByUsername,
}: {
  open: boolean
  onClose: () => void
  botUsername: string | null
  /** Add a single contact by name (+ optional phone). Throws on failure. */
  onAddByName: (name: string, phone?: string) => Promise<void>
  /** Add registered users by @handle list. Caller refreshes contacts. */
  onAddByUsername: (usernames: string) => Promise<UsernameAddResult>
}) {
  const { t } = useT()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('name')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [usernames, setUsernames] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setName('')
    setPhone('')
    setUsernames('')
  }

  const close = () => {
    reset()
    onClose()
  }

  const addName = async () => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      await onAddByName(n, phone.trim() || undefined)
      toast(t('add.added', { names: n }), 'ti-user-plus')
      close()
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409 ? t('add.name_taken') : (e as Error).message
      toast(msg, 'ti-alert-circle')
    } finally {
      setBusy(false)
    }
  }

  const addUsernames = async () => {
    const raw = usernames.trim()
    if (!raw || busy) return
    setBusy(true)
    try {
      const r = await onAddByUsername(raw)
      const lines: string[] = []
      if (r.added.length) lines.push(t('add.added', { names: r.added.join(', ') }))
      if (r.skipped.length) lines.push(t('add.skipped', { names: r.skipped.join(', ') }))
      if (r.notFound.length) {
        lines.push(t('add.not_found', { names: r.notFound.map((h) => `@${h}`).join(', ') }))
      }
      if (lines.length === 0) lines.push(r.selfSkipped ? t('add.self_skipped') : t('add.none_found'))
      const ok = r.added.length > 0
      toast(lines.join(' · '), ok ? 'ti-user-plus' : 'ti-alert-circle')
      if (ok) close()
      else setUsernames('')
    } catch (e) {
      toast((e as Error).message, 'ti-alert-circle')
    } finally {
      setBusy(false)
    }
  }

  const handoff = () => {
    if (!botUsername) return
    openTelegramLink(`https://t.me/${botUsername}?start=add_contacts`)
    close()
  }

  const telegramReady = !!botUsername && isInTelegram()

  return (
    <Sheet open={open} onClose={close} title={t('add.title')}>
      <div className="col" style={{ gap: 14, paddingBottom: 6 }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'name', label: t('add.tab_name') },
            { value: 'username', label: t('add.tab_username') },
            { value: 'telegram', label: t('add.tab_telegram') },
          ]}
        />

        {tab === 'name' && (
          <div className="col" style={{ gap: 10 }}>
            <input
              className="inp"
              value={name}
              placeholder={t('add.name_placeholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addName()}
            />
            <input
              className="inp"
              value={phone}
              type="tel"
              inputMode="tel"
              placeholder={t('add.phone_placeholder')}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addName()}
            />
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={addName}
              disabled={busy || !name.trim()}
            >
              {busy ? t('add.adding') : t('add.add_button')}
            </button>
          </div>
        )}

        {tab === 'username' && (
          <div className="col" style={{ gap: 10 }}>
            <textarea
              className="inp"
              value={usernames}
              placeholder={t('add.username_placeholder')}
              onChange={(e) => setUsernames(e.target.value)}
              style={{ minHeight: 64, resize: 'none' }}
            />
            <div className="muted3" style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.5 }}>
              {t('add.username_hint')}
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={addUsernames}
              disabled={busy || !usernames.trim()}
            >
              {busy ? t('add.adding') : t('add.add_button')}
            </button>
          </div>
        )}

        {tab === 'telegram' && (
          <div className="col" style={{ gap: 12 }}>
            <div className="muted" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.5 }}>
              {t('add.telegram_explain')}
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={handoff}
              disabled={!telegramReady}
            >
              <i className="ti ti-brand-telegram" style={{ marginRight: 8 }} />
              {t('add.telegram_button')}
            </button>
            {!telegramReady && (
              <div className="muted3" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t('add.telegram_unavailable')}
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}
