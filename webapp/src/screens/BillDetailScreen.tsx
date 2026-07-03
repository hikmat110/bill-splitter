import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { AuthImage } from '../components/AuthImage'
import { PhotoModal } from '../components/PhotoModal'
import { TextShareModal } from '../components/TextShareModal'
import { Money } from '../components/Money'
import { SecTitle, BreakdownLines } from '../components/common'
import { useToast } from '../components/Toast'
import { money } from '../lib/currency'
import { prettyDate } from '../lib/date'
import { buildBillText } from '../lib/billText'
import { copyText } from '../lib/clipboard'
import { api, ApiError } from '../lib/api'
import { haptic, onBackButton } from '../lib/telegram'
import { statusLabel, pillClass } from '../lib/status'
import { isSelf, createdOutstanding } from '../lib/billCalc'
import { useT } from '../i18n'
import type { BillDetail, BillParticipant, Me } from '../lib/types'

// Matches the server's MAX_UPLOAD_BYTES default.
const MAX_UPLOAD = 5_000_000

type Proof = { id: string; mime: string; previewUrl: string }

/**
 * Full-screen overlay showing one bill to either role: the creator manages it
 * (remind / confirm / dispute / edit / share / archive / delete), a payer pays
 * it (attach proof + mark paid). Both see the complete bill — items, every
 * participant's amount and status, receipt and proof photos — even after
 * settlement.
 */
export function BillDetailScreen({
  billId,
  me,
  seed,
  refresh,
  onClose,
  onEdit,
}: {
  billId: string
  me: Me
  /** Cached detail (created bills) for instant paint; the API is authoritative. */
  seed: BillDetail | null
  refresh: () => Promise<void>
  onClose: () => void
  onEdit: (bill: BillDetail) => void
}) {
  const { t, lang } = useT()
  const toast = useToast()
  const [bill, setBill] = useState<BillDetail | null>(seed)
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [share, setShare] = useState<{ text: string; hasCard: boolean } | null>(null)

  // Optional proof-of-transfer the payer attaches before marking paid.
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [proof, setProof] = useState<Proof | null>(null)

  // Telegram's native back button closes the overlay while it's up.
  useEffect(() => onBackButton(onClose), [onClose])

  const load = useCallback(async () => {
    try {
      setBill(await api.bill(billId))
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        toast(t('detail.bill_gone'), 'ti-alert-circle')
        await refresh().catch(() => undefined)
        onClose()
      } else {
        toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId])

  useEffect(() => {
    void load()
  }, [load])

  const reload = async () => {
    await refresh()
    await load()
  }

  if (!bill) {
    return (
      <div className="overlay-screen">
        <Header title="" sub="" onClose={onClose} />
        <div className="tg-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="muted" style={{ fontWeight: 600 }}>{t('common.loading')}</span>
        </div>
      </div>
    )
  }

  const isCreator = bill.creator.id === me.id
  const own = bill.participants.find((p) => isSelf(p, me)) ?? null
  const others = bill.participants.filter((p) => !isSelf(p, me))
  const outstanding = createdOutstanding(bill, me)
  const allSettled = others.length > 0 && others.every((p) => p.status === 'confirmed')
  // Mirror the server lock: editable only while every non-creator is still pending.
  const editable = bill.participants.every((p) => isSelf(p, me) || p.status === 'pending')

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string, icon: string) => {
    setBusy(key)
    try {
      await fn()
      await reload()
      haptic('success')
      toast(okMsg, icon)
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setBusy(null)
    }
  }

  // ── creator actions ─────────────────────────────────────────────────────────

  const onRemind = (p: BillParticipant) =>
    run(
      p.id,
      async () => {
        const r = await api.remind(bill.id, p.id)
        if (!r.ok) throw new ApiError(t('settle.reminded_recently'), 429)
      },
      t('settle.reminder_sent', { name: p.displayName }),
      'ti-bell'
    )

  const onConfirm = (p: BillParticipant) =>
    run(p.id, () => api.confirm(bill.id, p.id), t('settle.confirmed_payment', { name: p.displayName }), 'ti-check')

  const onDispute = (p: BillParticipant) => {
    const reason = window.prompt(t('settle.dispute_prompt', { name: p.displayName }))?.trim()
    if (!reason) return
    run(
      p.id,
      () => api.dispute(bill.id, p.id, reason),
      t('settle.disputed_payment', { name: p.displayName }),
      'ti-alert-triangle'
    )
  }

  // People who aren't on the bot get no Telegram notification — the creator can
  // copy the whole bill as plain text and send it to them by hand.
  const onShareBill = () => setShare({ text: buildBillText(bill, t), hasCard: !!bill.cardNumber })

  const handleCopy = async (text: string) => {
    if (await copyText(text)) {
      haptic('success')
      toast(t('share.copied'), 'ti-copy')
      setShare(null)
    } else {
      // Keep the modal open — its text block is selectable by hand.
      toast(t('share.copy_manual'), 'ti-alert-circle')
    }
  }

  const onArchiveToggle = () => {
    const archived = !!bill.archivedAt
    run(
      'archive',
      async () => {
        const updated = archived ? await api.unarchiveBill(bill.id) : await api.archiveBill(bill.id)
        setBill(updated)
      },
      archived ? t('detail.unarchived_toast') : t('detail.archived_toast'),
      'ti-archive'
    )
  }

  const onDelete = async () => {
    if (!window.confirm(t('detail.delete_confirm', { title: bill.title }))) return
    if (!window.confirm(t('detail.delete_confirm_final'))) return
    setBusy('delete')
    try {
      await api.deleteBill(bill.id)
      haptic('success')
      toast(t('detail.deleted_toast'), 'ti-trash')
      await refresh()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
      setBusy(null)
    }
  }

  // ── payer actions ───────────────────────────────────────────────────────────

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_UPLOAD) {
      toast(t('common.photo_too_large'), 'ti-alert-circle')
      return
    }
    setUploading(true)
    try {
      const ref = await api.uploadAttachment(file)
      setProof((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
        return { id: ref.id, mime: ref.mime, previewUrl: URL.createObjectURL(file) }
      })
      haptic('success')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.upload_failed'), 'ti-alert-circle')
    } finally {
      setUploading(false)
    }
  }

  const markPaid = () => {
    if (!own) return
    run(
      'paid',
      async () => {
        await api.markPaid(own.id, proof ? { attachmentId: proof.id, mime: proof.mime } : undefined)
        if (proof?.previewUrl) URL.revokeObjectURL(proof.previewUrl)
        setProof(null)
      },
      t('incoming.marked_paid'),
      'ti-check'
    )
  }

  const heroSettled = isCreator ? allSettled : own?.status === 'confirmed'

  return (
    <div className="overlay-screen">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <Header
        title={bill.title}
        sub={`${prettyDate(t, lang, bill.createdAt)} · ${money(bill.total)}`}
        onClose={onClose}
        right={
          isCreator && editable ? (
            <button className="btn btn-sm btn-soft" onClick={() => onEdit(bill)}>
              <i className="ti ti-pencil" /> {t('settle.edit')}
            </button>
          ) : undefined
        }
      />

      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        {/* hero */}
        <div
          className="card pop"
          style={{
            position: 'relative',
            marginBottom: 16,
            textAlign: 'center',
            padding: '22px 18px',
            background: heroSettled ? 'var(--pos-soft)' : 'var(--surface)',
            border: 'none',
          }}
        >
          {bill.receiptAttachmentId && (
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
              <AuthImage
                attachmentId={bill.receiptAttachmentId}
                onClick={() => setViewing(bill.receiptAttachmentId)}
                style={{ width: 34, height: 34, borderRadius: 9 }}
              />
            </div>
          )}
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '.3px',
              textTransform: 'uppercase',
              color: heroSettled ? 'var(--pos-text)' : 'var(--text-2)',
            }}
          >
            {isCreator
              ? allSettled
                ? t('settle.all_settled')
                : t('settle.youre_owed')
              : own?.status === 'confirmed'
                ? t('detail.all_paid')
                : t('detail.you_owe')}
          </div>
          <Money
            amount={isCreator ? outstanding : own?.amount ?? 0}
            style={{
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: '-1px',
              color: heroSettled ? 'var(--pos-text)' : 'var(--text)',
              display: 'block',
              marginTop: 4,
            }}
          />
          <div className="muted" style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
            {!isCreator && (
              <>
                {t('incoming.from', { name: bill.creator.firstName || t('common.friend') })}
                {' · '}
              </>
            )}
            {t('settle.bill_total_line', { title: bill.title, amount: money(bill.total) })}
          </div>
          {bill.archivedAt && (
            <span className="pill pill-mut" style={{ marginTop: 10 }}>
              <i className="ti ti-archive" style={{ fontSize: 12 }} /> {t('bills.archived_pill')}
            </span>
          )}
        </div>

        {/* payer: pay actions for their own share */}
        {!isCreator && own && (own.status === 'pending' || own.status === 'disputed') && (
          <div className="card pop" style={{ marginBottom: 16, padding: 'calc(13px * var(--dens))' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={'pill ' + pillClass(own.status)}>{statusLabel(t, own.status)}</span>
              <div className="row" style={{ gap: 7, alignItems: 'center' }}>
                {proof && (
                  <img
                    src={proof.previewUrl}
                    alt=""
                    style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover' }}
                  />
                )}
                <button
                  className="btn btn-sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  title={t('incoming.attach_photo')}
                >
                  <i className={'ti ' + (uploading ? 'ti-loader-2' : 'ti-paperclip')} />
                </button>
                <button className="btn btn-sm btn-primary" disabled={busy === 'paid'} onClick={markPaid}>
                  <i className="ti ti-check" /> {t('incoming.mark_paid')}
                </button>
              </div>
            </div>
          </div>
        )}
        {!isCreator && own?.status === 'marked_paid' && (
          <div
            className="card"
            style={{ marginBottom: 16, textAlign: 'center', padding: 14, fontWeight: 600, fontSize: 13.5, color: 'var(--text-2)' }}
          >
            {t('incoming.awaiting')}
          </div>
        )}

        {/* creator: one-tap whole-bill text to hand to anyone not on the bot */}
        {isCreator && others.length > 0 && (
          <button className="btn btn-block btn-soft" style={{ marginBottom: 16 }} onClick={onShareBill}>
            <i className="ti ti-copy" /> {t('share.button')}
          </button>
        )}

        {/* items — visible to every participant */}
        <SecTitle>{t('detail.items')}</SecTitle>
        <div className="card pop" style={{ marginBottom: 18, padding: 'calc(13px * var(--dens))' }}>
          <div className="col" style={{ gap: 7 }}>
            {bill.items.map((it) => (
              <div key={it.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {it.name}
                  {it.quantity > 1 && <span className="muted"> ×{it.quantity}</span>}
                </span>
                <span className="tnum" style={{ fontWeight: 700, fontSize: 13.5, flexShrink: 0 }}>
                  {money(it.price * it.quantity)}
                </span>
              </div>
            ))}
            {bill.servicePct > 0 && (
              <SummaryLine
                label={`${t('breakdown.service')} ${bill.servicePct}%`}
                amount={Math.max(0, bill.total - bill.subtotal - bill.tip)}
              />
            )}
            {bill.tip > 0 && <SummaryLine label={t('breakdown.tip')} amount={bill.tip} />}
            <div
              className="row"
              style={{ justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 3 }}
            >
              <span style={{ fontWeight: 800, fontSize: 14 }}>{t('split.bill_total')}</span>
              <Money amount={bill.total} style={{ fontWeight: 800, fontSize: 14 }} />
            </div>
          </div>
        </div>

        {/* creator: who owes you, with actions */}
        {isCreator && others.length > 0 && (
          <>
            <SecTitle>{t('settle.who_owes_you')}</SecTitle>
            <div className="col" style={{ gap: 10, marginBottom: 18 }}>
              {others.map((p) => (
                <div key={p.id} className="card pop" style={{ padding: 'calc(13px * var(--dens))' }}>
                  <div className="row" style={{ gap: 11 }}>
                    <Avatar id={p.contactId} name={p.displayName} size={38} />
                    <div className="col" style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, fontSize: 14.5 }}>{p.displayName}</span>
                      <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {statusLabel(t, p.status)}
                      </span>
                    </div>
                    <Money amount={p.amount} style={{ fontSize: 16, fontWeight: 800 }} />
                  </div>
                  <div
                    className="row"
                    style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    {p.paymentProofAttachmentId ? (
                      <AuthImage
                        attachmentId={p.paymentProofAttachmentId}
                        onClick={() => setViewing(p.paymentProofAttachmentId)}
                        style={{ width: 40, height: 40, borderRadius: 9 }}
                      />
                    ) : (
                      <span />
                    )}
                    {p.status === 'confirmed' ? (
                      <span className="pill pill-pos">
                        <i className="ti ti-check" style={{ fontSize: 13 }} /> {t('settle.settled')}
                      </span>
                    ) : (
                      <div className="row" style={{ gap: 7 }}>
                        {p.status === 'marked_paid' ? (
                          <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onDispute(p)}>
                            <i className="ti ti-x" /> {t('settle.dispute')}
                          </button>
                        ) : (
                          <button className="btn btn-sm" disabled={busy === p.id} onClick={() => onRemind(p)}>
                            <i className="ti ti-bell" /> {t('settle.remind')}
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy === p.id}
                          onClick={() => onConfirm(p)}
                        >
                          <i className="ti ti-check" /> {t('settle.confirm')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* per person — full itemization, both roles */}
        <SecTitle>{t('settle.per_person')}</SecTitle>
        <div className="col" style={{ gap: 10, marginBottom: 18 }}>
          {bill.participants.map((p) => {
            const self = isSelf(p, me)
            const creatorSelf = p.linkedUserId === bill.creator.id
            return (
              <div key={p.id} className="card pop" style={{ padding: 'calc(13px * var(--dens))' }}>
                <div className="row" style={{ gap: 11 }}>
                  <Avatar id={p.contactId} name={self ? t('common.you') : p.displayName} size={38} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14.5 }}>
                    {self ? t('common.you') : p.displayName}
                  </span>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <Money amount={p.amount} style={{ fontWeight: 800, fontSize: 16 }} />
                    <div className="row" style={{ gap: 6 }}>
                      {bill.tipPaidByContactId === p.contactId && (
                        <span className="pill pill-pos">
                          <i className="ti ti-coin" style={{ fontSize: 12 }} /> {t('settle.paid_tip_pill')}
                        </span>
                      )}
                      {creatorSelf ? (
                        <span className="pill pill-mut">{t('settle.spent_pill')}</span>
                      ) : (
                        <span className={'pill ' + pillClass(p.status)}>{statusLabel(t, p.status)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <BreakdownLines b={p} style={{ marginTop: 11, paddingLeft: 49 }} />
                {!isCreator && p.paymentProofAttachmentId && (
                  <div style={{ marginTop: 10, paddingLeft: 49 }}>
                    <AuthImage
                      attachmentId={p.paymentProofAttachmentId}
                      onClick={() => setViewing(p.paymentProofAttachmentId)}
                      style={{ width: 40, height: 40, borderRadius: 9 }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* creator: archive / delete */}
        {isCreator && (
          <div className="row" style={{ gap: 10 }}>
            <button
              className="btn btn-soft"
              style={{ flex: 1 }}
              disabled={busy === 'archive'}
              onClick={onArchiveToggle}
            >
              <i className={'ti ' + (bill.archivedAt ? 'ti-archive-off' : 'ti-archive')} />{' '}
              {bill.archivedAt ? t('detail.unarchive') : t('detail.archive')}
            </button>
            <button
              className="btn btn-soft"
              style={{ flex: 1, color: 'var(--neg-text)' }}
              disabled={busy === 'delete'}
              onClick={() => void onDelete()}
            >
              <i className="ti ti-trash" /> {t('detail.delete')}
            </button>
          </div>
        )}
      </div>

      <PhotoModal attachmentId={viewing} onClose={() => setViewing(null)} />
      <TextShareModal data={share} onClose={() => setShare(null)} onCopy={handleCopy} />
    </div>
  )
}

function Header({
  title,
  sub,
  onClose,
  right,
}: {
  title: string
  sub: string
  onClose: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="topbar" style={{ gap: 8 }}>
      <button className="icon-btn" onClick={onClose} aria-label="Back">
        <i className="ti ti-chevron-left" />
      </button>
      <div className="col" style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontWeight: 800,
            fontSize: 16.5,
            letterSpacing: '-.3px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
        {sub && (
          <span className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
            {sub}
          </span>
        )}
      </div>
      {right}
    </div>
  )
}

function SummaryLine({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
      <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
        {label}
      </span>
      <span className="muted tnum" style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
        {money(amount)}
      </span>
    </div>
  )
}
