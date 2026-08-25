import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar } from '../components/Avatar'
import { AuthImage } from '../components/AuthImage'
import { Money } from '../components/Money'
import { SecTitle } from '../components/common'
import { SnapSlider } from '../components/SnapSlider'
import { useToast } from '../components/Toast'
import { previewTotals, previewShares, to2 } from '../lib/calc'
import { amount, money } from '../lib/currency'
import { api, ApiError, MAX_UPLOAD } from '../lib/api'
import { uid } from '../lib/draft'
import type { DraftBill, DraftItem, Person } from '../lib/draft'
import { cardLabel, defaultCardId } from '../lib/cards'
import type { UserCard } from '../lib/types'
import { haptic, showAlert } from '../lib/telegram'
import { useT } from '../i18n'

const TIP_PRESETS = [0, 10_000, 20_000, 30_000]
const SERVICE_PRESETS = [0, 5, 10, 15, 20]
// Sentinel slider positions that reveal a free-form input.
const TIP_CUSTOM = -1
const SERVICE_CUSTOM = -1

export function SplitScreen({
  draft,
  setDraft,
  people,
  selfContactId,
  cards,
  onAddCard,
  onAddPeople,
  onSend,
  sending,
  onDiscard,
  hasCreatedBills,
}: {
  draft: DraftBill
  setDraft: (d: DraftBill) => void
  people: Person[]
  selfContactId: string
  cards: UserCard[]
  onAddCard: (number: string) => Promise<UserCard>
  onAddPeople: () => void
  onSend: () => void
  sending: boolean
  onDiscard: () => void
  /** Gates the first-bill onboarding checklist: only creating a bill counts as
   *  prior experience — received bills arrive passively. */
  hasCreatedBills: boolean
}) {
  const { t } = useT()
  const toast = useToast()
  const scanFileRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const editing = !!draft.editingBillId
  const calc = previewTotals(draft)
  const shares = previewShares(draft)
  const nameById = (id: string) => people.find((p) => p.id === id)?.name ?? '?'
  const participants = draft.participantIds
  // "Custom" sits right after Off — much easier to spot than at the far end.
  const serviceOptions = [
    { value: 0, label: t('common.off') },
    { value: SERVICE_CUSTOM, label: t('split.service_custom') },
    ...SERVICE_PRESETS.filter((p) => p > 0).map((p) => ({ value: p, label: p + '%' })),
  ]
  // Custom mode: the user tapped "Custom", or the value isn't one of the presets
  // (e.g. a fractional % derived from a receipt scan, or an edited bill).
  const [serviceCustomTap, setServiceCustomTap] = useState(false)
  const serviceCustom =
    serviceCustomTap || (draft.servicePct > 0 && !SERVICE_PRESETS.includes(draft.servicePct))
  // Custom mode: the tip isn't one of the presets, or the user picked "Custom".
  const [tipCustom, setTipCustom] = useState(() => draft.tip > 0 && !TIP_PRESETS.includes(draft.tip))
  const tipOptions = [
    { value: 0, label: t('common.none') },
    { value: TIP_CUSTOM, label: t('split.tip_custom') },
    ...TIP_PRESETS.filter((tp) => tp > 0).map((tp) => ({ value: tp, label: amount(tp) })),
  ]
  // Tip payer always includes the creator ("You", default) plus the participants.
  const payerOptions = [selfContactId, ...participants.filter((id) => id !== selfContactId)]
  const tipPayer = draft.tipPaidBy ?? selfContactId

  const patch = (p: Partial<DraftBill>) => setDraft({ ...draft, ...p })
  const patchItem = (id: string, p: Partial<DraftItem>) =>
    patch({ items: draft.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })
  const addItem = () =>
    patch({
      items: [
        ...draft.items,
        { id: uid(), name: '', price: 0, qty: 1, who: participants.map((id) => ({ id, units: null })) },
      ],
    })
  const removeItem = (id: string) => patch({ items: draft.items.filter((i) => i.id !== id) })
  const removePerson = (id: string) =>
    patch({
      participantIds: participants.filter((p) => p !== id),
      items: draft.items.map((i) => ({ ...i, who: i.who.filter((w) => w.id !== id) })),
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
      // The scan returns LINE totals plus the printed quantity; the editor's
      // price is per-unit, so divide it back out (floor-to-cent — sub-som dust
      // stays under the mismatch check's 1-som tolerance).
      const items: DraftItem[] = r.items.map((it) => {
        const qty = Math.min(999, Math.max(1, Math.round(it.quantity || 1)))
        return {
          id: uid(),
          name: it.name || t('split.default_item_name'),
          price: qty > 1 ? to2(it.price / qty) : it.price,
          qty,
          who: participants.map((id) => ({ id, units: null })), // empty until people are added
        }
      })
      // The scan ran but extracted nothing — tell the user instead of silently
      // pasting an empty list (which looks like "nothing happened").
      if (items.length === 0) {
        haptic('warning')
        showAlert(t('split.scan_empty'))
        return
      }
      const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0)
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
      const friendly = t(status === 503 ? 'split.scan_not_configured' : 'split.scan_failed')
      // Surface the real reason via a native alert (the toast wasn't showing for
      // some users). Append the status + server message so failures are diagnosable.
      const detail = e instanceof Error && e.message ? e.message : String(e)
      showAlert(`${friendly}\n\n[${status || 'no response'}] ${detail}`)
    } finally {
      setScanning(false)
    }
  }

  const removeReceipt = () => {
    if (draft.receiptPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.receiptPreviewUrl)
    patch({ receiptAttachmentId: null, receiptMime: null, receiptPreviewUrl: null })
  }

  // Card picker: undefined on the draft = "use my default card".
  const resolvedCardId = draft.cardId === undefined ? defaultCardId(cards) : draft.cardId
  const [addingCard, setAddingCard] = useState(false)
  const [cardInput, setCardInput] = useState('')
  const [cardBusy, setCardBusy] = useState(false)
  const cardSectionRef = useRef<HTMLDivElement>(null)

  // The getting-started card nudge: open the add-card input and bring it into view.
  const openCardAdd = () => {
    setAddingCard(true)
    setTimeout(
      () => cardSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      50
    )
  }

  const submitCard = async () => {
    const digits = cardInput.replace(/\D/g, '') // mirror the server's parseCardNumber
    if (digits.length !== 16) {
      toast(t('split.card_invalid'), 'ti-alert-circle')
      return
    }
    setCardBusy(true)
    try {
      const card = await onAddCard(digits)
      patch({ cardId: card.id })
      setAddingCard(false)
      setCardInput('')
      haptic('success')
      toast(t('split.card_added'), 'ti-credit-card')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.something_wrong'), 'ti-alert-circle')
    } finally {
      setCardBusy(false)
    }
  }

  const canSend =
    draft.title.trim().length > 0 &&
    participants.length > 0 &&
    draft.items.some((i) => i.price > 0 && i.who.length > 0)

  const hasContent =
    draft.title.trim().length > 0 ||
    participants.length > 0 ||
    draft.items.length > 0 ||
    !!draft.receiptAttachmentId

  // First-bill onboarding checklist — until the user has created a bill of
  // their own; everyone else gets the plain empty state.
  const showChecklist = draft.items.length === 0 && !hasCreatedBills

  const discard = () => {
    if (!window.confirm(t('app.draft_discard'))) return
    haptic('light')
    onDiscard()
  }

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
          {hasContent && !editing && (
            <button
              className="icon-btn"
              onClick={discard}
              title={t('app.draft_discard')}
              style={{ color: 'var(--text-3)', flexShrink: 0 }}
            >
              <i className="ti ti-trash" style={{ fontSize: 17 }} />
            </button>
          )}
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
        {draft.items.length === 0 && !showChecklist && (
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
        {showChecklist && (
          <div className="card pop" style={{ padding: 'calc(15px * var(--dens))' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 13 }}>
              {t('split.gs_title')}
            </div>
            <div className="col" style={{ gap: 12 }}>
              <GsStep
                n={1}
                done={participants.length > 0}
                label={t('split.gs_people')}
                action={
                  participants.length === 0 && (
                    <button
                      className="btn btn-sm btn-soft"
                      onClick={onAddPeople}
                      style={{ flexShrink: 0 }}
                    >
                      <i className="ti ti-plus" />
                    </button>
                  )
                }
              />
              <GsStep n={2} done={false} label={t('split.gs_items')} />
              {/* wrap: long labels (uz/ru) stack the buttons instead of overflowing */}
              <div className="row" style={{ gap: 8, paddingLeft: 36, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: '1 1 auto' }}
                  disabled={participants.length === 0 || scanning}
                  onClick={() => scanFileRef.current?.click()}
                >
                  <i className={'ti ' + (scanning ? 'ti-loader-2' : 'ti-sparkles')} />{' '}
                  {scanning ? t('split.scanning') : t('split.scan_receipt')}
                </button>
                <button
                  className="btn"
                  style={{ flex: '1 1 auto' }}
                  disabled={participants.length === 0}
                  onClick={addItem}
                >
                  <i className="ti ti-plus" /> {t('split.add_item')}
                </button>
              </div>
              <GsStep n={3} done={canSend} label={t('split.gs_send')} />
            </div>
            {cards.length === 0 && (
              <div
                className="row"
                style={{
                  gap: 8,
                  alignItems: 'center',
                  marginTop: 13,
                  paddingTop: 13,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <i
                  className="ti ti-credit-card"
                  style={{ fontSize: 16, color: 'var(--text-3)', flexShrink: 0 }}
                />
                <span className="muted" style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>
                  {t('split.card_nudge')}
                </span>
                <button className="btn btn-sm" onClick={openCardAdd} style={{ flexShrink: 0 }}>
                  {t('split.add_card')}
                </button>
              </div>
            )}
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
        {!showChecklist && (
          <button
            className="btn btn-soft btn-block"
            onClick={addItem}
            disabled={participants.length === 0}
          >
            <i className="ti ti-plus" /> {t('split.add_item')}
          </button>
        )}
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
            value={serviceCustom ? SERVICE_CUSTOM : draft.servicePct}
            onChange={(v) => {
              if (v === SERVICE_CUSTOM) {
                setServiceCustomTap(true)
              } else {
                setServiceCustomTap(false)
                patch({ servicePct: v })
              }
            }}
          />
          {serviceCustom && (
            <input
              className="inp"
              type="number"
              inputMode="decimal"
              value={draft.servicePct || ''}
              placeholder="0"
              autoFocus
              onChange={(e) =>
                patch({ servicePct: to2(Math.min(100, Math.max(0, Number(e.target.value) || 0))) })
              }
              style={{ textAlign: 'right', fontWeight: 700, fontSize: 15, padding: '8px 10px' }}
            />
          )}
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

      {/* card participants should pay to — default preselected, changeable per bill */}
      <SecTitle>{t('split.pay_to_card')}</SecTitle>
      <div className="card" ref={cardSectionRef} style={{ padding: 'calc(14px * var(--dens))' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {cards.map((c) => {
            const on = resolvedCardId === c.id
            return (
              <button
                key={c.id}
                onClick={() => {
                  haptic('light')
                  patch({ cardId: c.id })
                }}
                className="row"
                style={cardPillStyle(on)}
              >
                <i className="ti ti-credit-card" style={{ fontSize: 16 }} />
                <span>{cardLabel(c)}</span>
                {on && <i className="ti ti-check" style={{ fontSize: 14 }} />}
              </button>
            )
          })}
          <button
            onClick={() => {
              haptic('light')
              patch({ cardId: null })
            }}
            className="row"
            style={cardPillStyle(resolvedCardId === null)}
          >
            <i className="ti ti-credit-card-off" style={{ fontSize: 16 }} />
            <span>{t('split.no_card')}</span>
            {resolvedCardId === null && <i className="ti ti-check" style={{ fontSize: 14 }} />}
          </button>
          <button
            onClick={() => setAddingCard((v) => !v)}
            className="row"
            style={cardPillStyle(false)}
          >
            <i className="ti ti-plus" style={{ fontSize: 16 }} />
            <span>{t('split.add_card')}</span>
          </button>
        </div>
        {addingCard && (
          <div className="row" style={{ gap: 8, marginTop: 11 }}>
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
            <button className="btn btn-sm btn-primary" disabled={cardBusy} onClick={() => void submitCard()}>
              <i className={'ti ' + (cardBusy ? 'ti-loader-2' : 'ti-check')} />
            </button>
          </div>
        )}
      </div>

      {/* receipt photo (optional) */}
      <SecTitle>{t('split.receipt_photo')}</SecTitle>
      <div className="card" style={{ padding: 'calc(14px * var(--dens))' }}>
        <input
          ref={scanFileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            onScanReceipt(e.target.files?.[0])
            e.target.value = '' // allow re-picking the same file
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
                style={{ width: 56, height: 56, borderRadius: 'var(--r)', objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <AuthImage
                attachmentId={draft.receiptAttachmentId}
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
          // Same people-first gate as the checklist's scan button: scanned
          // items are assigned to the current participants, so scanning with
          // nobody on the bill produces items nobody owns.
          <button
            className="btn btn-block"
            disabled={participants.length === 0}
            onClick={() => scanFileRef.current?.click()}
          >
            <i className="ti ti-sparkles" /> {t('split.scan_receipt')}
          </button>
        )}
      </div>

      {/* per-person preview — how much each person owes so far */}
      {shares.length > 0 && (
        <>
          <SecTitle>{t('split.per_person')}</SecTitle>
          <div className="card" style={{ padding: 'calc(13px * var(--dens))' }}>
            <div className="col" style={{ gap: 10 }}>
              {shares.map((s) => (
                <div key={s.id} className="row" style={{ gap: 11, alignItems: 'center' }}>
                  <Avatar id={s.id} name={nameById(s.id)} size={30} />
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14 }}>
                    {nameById(s.id)}
                  </span>
                  <Money amount={s.amount} style={{ fontWeight: 800, fontSize: 15.5 }} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

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

/** One row of the getting-started checklist: numbered badge that flips to a
 *  check once done, a label, and an optional trailing action. */
function GsStep({
  n,
  done,
  label,
  action,
}: {
  n: number
  done: boolean
  label: string
  action?: ReactNode
}) {
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          background: done ? 'var(--pos-soft)' : 'var(--accent-soft)',
          color: done ? 'var(--pos-text)' : 'var(--accent-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12.5,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {done ? <i className="ti ti-check" style={{ fontSize: 14 }} /> : n}
      </div>
      <span
        style={{
          fontWeight: 600,
          fontSize: 13.5,
          flex: 1,
          color: done ? 'var(--text-3)' : 'var(--text)',
        }}
      >
        {label}
      </span>
      {action}
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
  const toast = useToast()
  const qty = Math.max(1, Math.floor(item.qty || 1))
  const who = item.who.filter((w) => participants.includes(w.id))
  const multi = who.length > 1
  const assigned = who.reduce((s, w) => s + (w.units ?? 0), 0)
  const remainder = Math.max(0, qty - assigned)

  const toggleWho = (id: string) => {
    const has = item.who.some((w) => w.id === id)
    onPatch({
      who: has ? item.who.filter((w) => w.id !== id) : [...item.who, { id, units: null }],
    })
  }

  const setQty = (next: number) => {
    const q = Math.max(1, Math.floor(next))
    // Explicit assignments can't survive a shrink below their sum — reset to
    // the equal split rather than guessing whose count to cut.
    if (assigned > q) {
      onPatch({ qty: q, who: item.who.map((w) => ({ ...w, units: null })) })
      toast(t('split.units_reset'), 'ti-refresh')
    } else {
      onPatch({ qty: q })
    }
  }

  const setUnits = (id: string, units: number | null) =>
    onPatch({ who: item.who.map((w) => (w.id === id ? { ...w, units } : w)) })

  const perHead = who.length ? money((item.price * qty) / who.length) : '—'

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
          title={qty > 1 ? t('split.price_per_unit') : undefined}
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

      {/* quantity stepper + line total */}
      <div className="row" style={{ gap: 8, marginTop: 11, alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {t('split.qty')}
        </span>
        <Stepper
          display={String(qty)}
          canDec={qty > 1}
          onDec={() => setQty(qty - 1)}
          onInc={() => setQty(qty + 1)}
        />
        <span style={{ flex: 1 }} />
        {qty > 1 && item.price > 0 && (
          <span className="muted tnum" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {qty} × {money(item.price)} = {money(item.price * qty)}
          </span>
        )}
      </div>

      <div className="row" style={{ gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
        {participants.map((id) => {
          const on = item.who.some((w) => w.id === id)
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

      {/* per-person unit assignment — only meaningful for multi-unit items */}
      {qty > 1 && who.length > 0 && (
        <div className="col" style={{ gap: 7, marginTop: 11 }}>
          {who.map((w) => {
            const maxForW = (w.units ?? 0) + remainder
            return (
              <div key={w.id} className="row" style={{ gap: 9, alignItems: 'center' }}>
                <Avatar id={w.id} name={nameById(w.id)} size={24} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontWeight: 600,
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {nameById(w.id)}
                </span>
                {w.units != null && item.price > 0 && (
                  <span className="muted tnum" style={{ fontSize: 12, fontWeight: 600 }}>
                    {money(w.units * item.price)}
                  </span>
                )}
                <Stepper
                  display={w.units == null ? t('split.units_auto') : String(w.units)}
                  canDec={w.units != null}
                  canInc={w.units == null ? remainder > 0 : (w.units ?? 0) < maxForW}
                  onDec={() => setUnits(w.id, w.units === 1 ? null : (w.units ?? 1) - 1)}
                  onInc={() => setUnits(w.id, (w.units ?? 0) + 1)}
                />
              </div>
            )
          })}
          {remainder > 0 && assigned > 0 && (
            <span className="muted" style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>
              {t('split.units_left', { n: remainder })}
            </span>
          )}
        </div>
      )}

      {multi && qty === 1 && (
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

/** Selected/idle pill styling for the card picker (mirrors the tip-payer pills). */
function cardPillStyle(on: boolean): React.CSSProperties {
  return {
    gap: 7,
    background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
    color: on ? 'var(--accent-text)' : 'inherit',
    borderRadius: 'var(--r-pill)',
    padding: '7px 12px',
    fontWeight: 600,
    fontSize: 13.5,
    border: on ? '1px solid var(--accent)' : '1px solid transparent',
    cursor: 'pointer',
  }
}

/** Compact − / value / + control shared by the qty and per-person unit rows. */
function Stepper({
  display,
  canDec,
  canInc = true,
  onDec,
  onInc,
}: {
  display: string
  canDec: boolean
  canInc?: boolean
  onDec: () => void
  onInc: () => void
}) {
  return (
    <div
      className="row"
      style={{
        gap: 0,
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-pill)',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <button
        className="icon-btn"
        disabled={!canDec}
        onClick={() => {
          haptic('light')
          onDec()
        }}
        style={{ width: 28, height: 28, fontSize: 14, background: 'none', border: 'none', opacity: canDec ? 1 : 0.35 }}
      >
        <i className="ti ti-minus" />
      </button>
      <span
        className="tnum"
        style={{ minWidth: 34, textAlign: 'center', fontWeight: 700, fontSize: 13 }}
      >
        {display}
      </span>
      <button
        className="icon-btn"
        disabled={!canInc}
        onClick={() => {
          haptic('light')
          onInc()
        }}
        style={{ width: 28, height: 28, fontSize: 14, background: 'none', border: 'none', opacity: canInc ? 1 : 0.35 }}
      >
        <i className="ti ti-plus" />
      </button>
    </div>
  )
}
