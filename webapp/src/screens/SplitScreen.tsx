import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { AuthImage } from '../components/AuthImage'
import { Money } from '../components/Money'
import { SecTitle } from '../components/common'
import { SnapSlider } from '../components/SnapSlider'
import { useToast } from '../components/Toast'
import { previewTotals, to2 } from '../lib/calc'
import { money } from '../lib/currency'
import { api, ApiError } from '../lib/api'
import { uid } from '../lib/draft'
import type { DraftBill, DraftItem, Person } from '../lib/draft'
import { haptic } from '../lib/telegram'
import { useT } from '../i18n'

const TIP_PRESETS = [0, 10_000, 20_000, 30_000]
const SERVICE_PRESETS = [0, 5, 10, 15, 20]
// Sentinel slider position that reveals a free-form tip input.
const TIP_CUSTOM = -1
// Matches the server's MAX_UPLOAD_BYTES default — checked client-side for fast feedback.
const MAX_UPLOAD = 5_000_000

export function SplitScreen({
  draft,
  setDraft,
  people,
  selfContactId,
  onAddPeople,
  onSend,
  sending,
}: {
  draft: DraftBill
  setDraft: (d: DraftBill) => void
  people: Person[]
  selfContactId: string
  onAddPeople: () => void
  onSend: () => void
  sending: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const scanFileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const editing = !!draft.editingBillId
  const calc = previewTotals(draft)
  const nameById = (id: string) => people.find((p) => p.id === id)?.name ?? '?'
  const participants = draft.participantIds
  const serviceOptions = SERVICE_PRESETS.map((p) => ({ value: p, label: p ? p + '%' : t('common.off') }))
  // Custom mode: the tip isn't one of the presets, or the user picked "Custom".
  const [tipCustom, setTipCustom] = useState(() => draft.tip > 0 && !TIP_PRESETS.includes(draft.tip))
  const tipOptions = [
    ...TIP_PRESETS.map((tp) => ({ value: tp, label: tp === 0 ? t('common.none') : money(tp) })),
    { value: TIP_CUSTOM, label: t('split.tip_custom') },
  ]
  // Tip payer always includes the creator ("You", default) plus the participants.
  const payerOptions = [selfContactId, ...participants.filter((id) => id !== selfContactId)]
  const tipPayer = draft.tipPaidBy ?? selfContactId

  const patch = (p: Partial<DraftBill>) => setDraft({ ...draft, ...p })
  const patchItem = (id: string, p: Partial<DraftItem>) =>
    patch({ items: draft.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })
  const addItem = () =>
    patch({ items: [...draft.items, { id: uid(), name: '', price: 0, who: [...participants] }] })
  const removeItem = (id: string) => patch({ items: draft.items.filter((i) => i.id !== id) })
  const removePerson = (id: string) =>
    patch({
      participantIds: participants.filter((p) => p !== id),
      items: draft.items.map((i) => ({ ...i, who: i.who.filter((w) => w !== id) })),
      // If the removed person was paying the tip, fall back to the creator.
      ...(draft.tipPaidBy === id ? { tipPaidBy: null } : {}),
    })

  // Upload `file` as the receipt photo. Returns the stored ref + a fresh local
  // preview URL, or null (after toasting) on failure. Does NOT patch the draft so
  // callers fold the result into a single setDraft — patch() spreads a stale
  // `draft`, so two patches in one handler would clobber each other.
  const uploadReceipt = async (
    file: File
  ): Promise<{ id: string; mime: string; previewUrl: string } | null> => {
    try {
      const ref = await api.uploadAttachment(file)
      if (draft.receiptPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.receiptPreviewUrl)
      return { id: ref.id, mime: ref.mime, previewUrl: URL.createObjectURL(file) }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.upload_failed'), 'ti-alert-circle')
      return null
    }
  }

  const tooLarge = (file: File) => {
    if (file.size <= MAX_UPLOAD) return false
    toast(t('common.photo_too_large'), 'ti-alert-circle')
    return true
  }

  const onPickReceipt = async (file: File | undefined) => {
    if (!file || tooLarge(file)) return
    setUploading(true)
    try {
      const up = await uploadReceipt(file)
      if (!up) return
      patch({ receiptAttachmentId: up.id, receiptMime: up.mime, receiptPreviewUrl: up.previewUrl })
      haptic('success')
    } finally {
      setUploading(false)
    }
  }

  // Scan a photo: upload it (also attaches it as the receipt), send it to Gemini,
  // then REPLACE the items with what was extracted and derive the service %.
  const onScanReceipt = async (file: File | undefined) => {
    if (!file || tooLarge(file)) return
    setScanning(true)
    try {
      const up = await uploadReceipt(file)
      if (!up) return
      // Attach the photo right away so it's kept even if scanning then fails.
      patch({ receiptAttachmentId: up.id, receiptMime: up.mime, receiptPreviewUrl: up.previewUrl })
      const r = await api.scanReceipt(up.id, up.mime)
      const items: DraftItem[] = r.items.map((it) => ({
        id: uid(),
        name: it.name || t('split.default_item_name'),
        price: it.price,
        who: [...participants], // empty until the user adds people
      }))
      const subtotal = items.reduce((s, it) => s + it.price, 0)
      const servicePct =
        r.serviceAmount > 0 && subtotal > 0
          ? to2((r.serviceAmount / subtotal) * 100)
          : (r.servicePct ?? 0)
      // Re-include the receipt fields: patch() spreads a stale `draft`, so this
      // single set must carry them or it would drop the photo attached above.
      patch({
        items,
        servicePct,
        receiptAttachmentId: up.id,
        receiptMime: up.mime,
        receiptPreviewUrl: up.previewUrl,
      })
      haptic('success')
      const service = to2((subtotal * servicePct) / 100)
      const computedTotal = to2(subtotal + service) + (draft.tip || 0)
      const mismatch = r.total != null && Math.abs(computedTotal - r.total) > 1
      toast(
        mismatch ? t('split.scan_check_total') : t('split.scan_found', { n: items.length }),
        mismatch ? 'ti-alert-triangle' : 'ti-sparkles'
      )
    } catch (e) {
      haptic('error')
      const status = e instanceof ApiError ? e.status : 0
      toast(t(status === 503 ? 'split.scan_not_configured' : 'split.scan_failed'), 'ti-alert-circle')
    } finally {
      setScanning(false)
    }
  }

  const removeReceipt = () => {
    if (draft.receiptPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.receiptPreviewUrl)
    patch({ receiptAttachmentId: null, receiptMime: null, receiptPreviewUrl: null })
  }

  const canSend =
    draft.title.trim().length > 0 &&
    participants.length > 0 &&
    draft.items.some((i) => i.price > 0 && i.who.length > 0)

  return (
    <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
      {/* identity */}
      <div className="card pop" style={{ marginBottom: 14, padding: 'calc(15px * var(--dens))' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <i className="ti ti-receipt-2" style={{ fontSize: 26, color: 'var(--accent)' }} />
          </div>
          <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <input
              className="inp ghost"
              value={draft.title}
              placeholder={t('split.untitled')}
              onChange={(e) => patch({ title: e.target.value })}
              style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.3px' }}
            />
            <div
              className="row"
              style={{ gap: 6, color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}
            >
              <i className="ti ti-calendar" style={{ fontSize: 15 }} />
              <span>{t('common.today')}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <i className="ti ti-users" style={{ fontSize: 15 }} />
              <span>{t('split.people', { n: participants.length })}</span>
            </div>
          </div>
        </div>

        {/* people */}
        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {participants.map((id) => (
            <div
              key={id}
              className="row"
              style={{
                gap: 7,
                background: 'var(--surface-2)',
                borderRadius: 'var(--r-pill)',
                padding: '4px 11px 4px 4px',
                fontWeight: 600,
                fontSize: 13.5,
              }}
            >
              <Avatar id={id} name={nameById(id)} size={26} />
              <span>{nameById(id)}</span>
              <i
                className="ti ti-x"
                onClick={() => removePerson(id)}
                style={{ fontSize: 14, color: 'var(--text-3)', cursor: 'pointer' }}
              />
            </div>
          ))}
          <button
            className="icon-btn"
            onClick={onAddPeople}
            style={{
              width: 34,
              height: 34,
              fontSize: 17,
              background: 'var(--accent-soft)',
              color: 'var(--accent-text)',
              border: 'none',
            }}
          >
            <i className="ti ti-plus" />
          </button>
        </div>
      </div>

      {/* items */}
      <SecTitle>{t('split.items', { n: draft.items.length })}</SecTitle>

      <div className="col" style={{ gap: 10, marginBottom: 18 }}>
        {draft.items.length === 0 && (
          <div
            className="card"
            style={{
              textAlign: 'center',
              color: 'var(--text-3)',
              fontSize: 14,
              fontWeight: 600,
              padding: 22,
            }}
          >
            {t('split.no_items')}
          </div>
        )}
        {draft.items.map((item, i) => (
          <ItemCard
            key={item.id}
            item={item}
            idx={i}
            participants={participants}
            nameById={nameById}
            onPatch={(p) => patchItem(item.id, p)}
            onRemove={() => removeItem(item.id)}
          />
        ))}
        <button
          className="btn btn-soft btn-block"
          onClick={addItem}
          disabled={participants.length === 0}
        >
          <i className="ti ti-plus" /> {t('split.add_item')}
        </button>
      </div>

      {/* adjustments */}
      <SecTitle>{t('split.service_tip')}</SecTitle>
      <div className="card" style={{ padding: 'calc(15px * var(--dens))' }}>
        <div className="col" style={{ gap: 10 }}>
          <div className="between">
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>{t('split.service_charge')}</span>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {calc.service > 0 ? '+' + money(calc.service) : t('common.none')}
            </span>
          </div>
          <SnapSlider
            options={serviceOptions}
            value={draft.servicePct}
            onChange={(v) => patch({ servicePct: v })}
          />
        </div>
        <div style={{ height: 1, background: 'var(--border)', margin: '14px -2px' }} />
        <div className="col" style={{ gap: 10 }}>
          <div className="between">
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>{t('split.tip')}</span>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {draft.tip > 0 ? '+' + money(draft.tip) : t('common.none')}
            </span>
          </div>
          <SnapSlider
            options={tipOptions}
            value={tipCustom ? TIP_CUSTOM : draft.tip}
            onChange={(v) => {
              if (v === TIP_CUSTOM) {
                setTipCustom(true)
              } else {
                setTipCustom(false)
                patch({ tip: v })
              }
            }}
          />
          {tipCustom && (
            <input
              className="inp"
              type="number"
              inputMode="numeric"
              value={draft.tip || ''}
              placeholder="0"
              autoFocus
              onChange={(e) => patch({ tip: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, padding: '8px 10px' }}
            />
          )}
        </div>

        {/* who paid the tip — only relevant once there's a tip */}
        {draft.tip > 0 && (
          <>
            <div style={{ height: 1, background: 'var(--border)', margin: '14px -2px' }} />
            <div className="col" style={{ gap: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>{t('split.tip_paid_by')}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {payerOptions.map((id) => {
                  const on = id === tipPayer
                  const label = id === selfContactId ? t('common.you') : nameById(id)
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        haptic('light')
                        patch({ tipPaidBy: id === selfContactId ? null : id })
                      }}
                      className="row"
                      style={{
                        gap: 7,
                        background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                        color: on ? 'var(--accent-text)' : 'inherit',
                        borderRadius: 'var(--r-pill)',
                        padding: '4px 11px 4px 4px',
                        fontWeight: 600,
                        fontSize: 13.5,
                        border: on ? '1px solid var(--accent)' : '1px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <Avatar id={id} name={label} size={26} />
                      <span>{label}</span>
                      {on && <i className="ti ti-check" style={{ fontSize: 14 }} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* receipt photo (optional) */}
      <SecTitle>{t('split.receipt_photo')}</SecTitle>
      <div className="card" style={{ padding: 'calc(14px * var(--dens))' }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            onPickReceipt(e.target.files?.[0])
            e.target.value = '' // allow re-picking the same file
          }}
        />
        <input
          ref={scanFileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            onScanReceipt(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {scanning ? (
          <div
            className="row"
            style={{ gap: 10, alignItems: 'center', justifyContent: 'center', padding: '6px 0' }}
          >
            <i className="ti ti-loader-2 spin" style={{ fontSize: 18, color: 'var(--accent)' }} />
            <span className="muted" style={{ fontSize: 13.5, fontWeight: 600 }}>
              {t('split.scanning')}
            </span>
          </div>
        ) : draft.receiptAttachmentId ? (
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            {draft.receiptPreviewUrl ? (
              <img
                src={draft.receiptPreviewUrl}
                alt=""
                onClick={() => fileRef.current?.click()}
                style={{ width: 56, height: 56, borderRadius: 'var(--r)', objectFit: 'cover', cursor: 'pointer', flexShrink: 0 }}
              />
            ) : (
              <AuthImage
                attachmentId={draft.receiptAttachmentId}
                onClick={() => fileRef.current?.click()}
                style={{ width: 56, height: 56, borderRadius: 'var(--r)', flexShrink: 0 }}
              />
            )}
            <span className="muted" style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>
              {t('split.receipt_hint')}
            </span>
            <i
              className="ti ti-trash"
              onClick={removeReceipt}
              style={{ fontSize: 18, color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0 }}
            />
          </div>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            <button
              className="btn btn-block"
              disabled={uploading}
              onClick={() => scanFileRef.current?.click()}
            >
              <i className="ti ti-sparkles" /> {t('split.scan_receipt')}
            </button>
            <button
              className="btn btn-soft btn-block"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <i className={'ti ' + (uploading ? 'ti-loader-2 spin' : 'ti-camera')} />{' '}
              {uploading ? t('split.sending') : t('split.add_photo')}
            </button>
          </div>
        )}
      </div>

      {/* total bar */}
      <div
        className="card pop"
        style={{
          marginTop: 16,
          padding: 'calc(16px * var(--dens))',
          background: 'var(--text)',
          border: 'none',
          color: 'var(--bg)',
        }}
      >
        <div className="between">
          <div className="col" style={{ gap: 2 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.6 }}>{t('split.bill_total')}</span>
            <Money amount={calc.total} style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.5px' }} />
          </div>
          <button
            className="btn"
            onClick={() => {
              haptic('medium')
              onSend()
            }}
            disabled={!canSend || sending}
            style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', fontWeight: 700 }}
          >
            {sending ? (
              editing ? t('split.updating') : t('split.sending')
            ) : (
              <>
                {editing ? t('split.update') : t('split.send')} <i className="ti ti-send" />
              </>
            )}
          </button>
        </div>
        <div
          className="row"
          style={{ gap: 16, marginTop: 12, fontSize: 12.5, fontWeight: 600, opacity: 0.7 }}
        >
          <span>{t('split.subtotal', { amount: money(calc.subtotal) })}</span>
          {calc.service > 0 && <span>· {t('split.service', { amount: money(calc.service) })}</span>}
          {calc.tip > 0 && <span>· {t('split.tip_summary', { amount: money(calc.tip) })}</span>}
        </div>
      </div>
    </div>
  )
}

function ItemCard({
  item,
  idx,
  participants,
  nameById,
  onPatch,
  onRemove,
}: {
  item: DraftItem
  idx: number
  participants: string[]
  nameById: (id: string) => string
  onPatch: (p: Partial<DraftItem>) => void
  onRemove: () => void
}) {
  const { t } = useT()
  const who = item.who.filter((w) => participants.includes(w))
  const multi = who.length > 1
  const toggleWho = (id: string) => {
    const has = item.who.includes(id)
    onPatch({ who: has ? item.who.filter((w) => w !== id) : [...item.who, id] })
  }
  const perHead = who.length ? money(item.price / who.length) : '—'

  return (
    <div className="card pop" style={{ padding: 'calc(13px * var(--dens))' }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 9,
            background: 'var(--accent-soft)',
            color: 'var(--accent-text)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12.5,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {idx + 1}
        </div>
        <input
          className="inp ghost"
          value={item.name}
          placeholder={t('split.item_name')}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ flex: 1, fontWeight: 700, fontSize: 15 }}
        />
        <input
          className="inp"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={item.price || ''}
          placeholder="0"
          onChange={(e) =>
            onPatch({ price: Math.max(0, Math.round((Number(e.target.value) || 0) * 100) / 100) })
          }
          style={{ width: 96, textAlign: 'right', fontWeight: 700, fontSize: 15, padding: '8px 10px' }}
        />
        <i
          className="ti ti-trash"
          onClick={onRemove}
          style={{ fontSize: 17, color: 'var(--text-3)', cursor: 'pointer', flexShrink: 0 }}
        />
      </div>

      <div className="row" style={{ gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
        {participants.map((id) => {
          const on = item.who.includes(id)
          return (
            <button
              key={id}
              onClick={() => toggleWho(id)}
              title={nameById(id)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                padding: 0,
                position: 'relative',
                opacity: on ? 1 : 0.32,
                filter: on ? 'none' : 'grayscale(.6)',
                transition: 'opacity .15s, filter .15s',
              }}
            >
              <Avatar id={id} name={nameById(id)} size={32} />
              {on && (
                <span
                  style={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: 'var(--accent)',
                    border: '2px solid var(--surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <i className="ti ti-check" style={{ fontSize: 8, color: 'var(--on-accent)' }} />
                </span>
              )}
            </button>
          )
        })}
      </div>

      {multi && (
        <div className="row" style={{ gap: 8, marginTop: 11, justifyContent: 'flex-end' }}>
          <span
            className="muted tnum"
            style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            {t('split.each', { amount: perHead })}
          </span>
        </div>
      )}
    </div>
  )
}
