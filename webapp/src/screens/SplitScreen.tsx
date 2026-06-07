import { Avatar } from '../components/Avatar'
import { Money } from '../components/Money'
import { SecTitle } from '../components/common'
import { previewTotals } from '../lib/calc'
import { money } from '../lib/currency'
import { uid } from '../lib/draft'
import type { DraftBill, DraftItem, Person } from '../lib/draft'
import { haptic } from '../lib/telegram'

const TIP_PRESETS = [0, 10_000, 20_000, 30_000]
const SERVICE_PRESETS = [0, 5, 10, 15]

export function SplitScreen({
  draft,
  setDraft,
  people,
  onAddPeople,
  onSend,
  sending,
}: {
  draft: DraftBill
  setDraft: (d: DraftBill) => void
  people: Person[]
  onAddPeople: () => void
  onSend: () => void
  sending: boolean
}) {
  const calc = previewTotals(draft)
  const nameById = (id: string) => people.find((p) => p.id === id)?.name ?? '?'
  const participants = draft.participantIds

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
    })

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
              placeholder="Untitled bill"
              onChange={(e) => patch({ title: e.target.value })}
              style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.3px' }}
            />
            <div
              className="row"
              style={{ gap: 6, color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}
            >
              <i className="ti ti-calendar" style={{ fontSize: 15 }} />
              <span>Today</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <i className="ti ti-users" style={{ fontSize: 15 }} />
              <span>{participants.length} people</span>
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
      <SecTitle
        action={
          <button
            className="btn btn-sm btn-soft"
            onClick={addItem}
            disabled={participants.length === 0}
            style={{ padding: '6px 12px' }}
          >
            <i className="ti ti-plus" /> Item
          </button>
        }
      >
        Items · {draft.items.length}
      </SecTitle>

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
            No items yet — add people, then add an item.
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
      </div>

      {/* adjustments */}
      <SecTitle>Service · Tip</SecTitle>
      <div className="card" style={{ padding: 'calc(15px * var(--dens))' }}>
        <div className="between" style={{ marginBottom: 14 }}>
          <div className="col" style={{ gap: 2 }}>
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>Service charge</span>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {calc.service > 0 ? '+' + money(calc.service) : 'None'}
            </span>
          </div>
          <div className="seg">
            {SERVICE_PRESETS.map((p) => (
              <button
                key={p}
                className={draft.servicePct === p ? 'on' : ''}
                onClick={() => patch({ servicePct: p })}
              >
                {p ? p + '%' : 'Off'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--border)', margin: '0 -2px 14px' }} />
        <div className="col" style={{ gap: 9 }}>
          <div className="between">
            <span style={{ fontWeight: 700, fontSize: 14.5 }}>Tip</span>
            <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {draft.tip > 0 ? '+' + money(draft.tip) : 'None'}
            </span>
          </div>
          <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
            {TIP_PRESETS.map((t) => (
              <button
                key={t}
                className={'chip' + (draft.tip === t ? ' on' : '')}
                onClick={() => patch({ tip: t })}
              >
                {t === 0 ? 'No tip' : money(t)}
              </button>
            ))}
          </div>
        </div>
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
            <span style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.6 }}>Bill total</span>
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
              'Sending…'
            ) : (
              <>
                Send <i className="ti ti-send" />
              </>
            )}
          </button>
        </div>
        <div
          className="row"
          style={{ gap: 16, marginTop: 12, fontSize: 12.5, fontWeight: 600, opacity: 0.7 }}
        >
          <span>Subtotal {money(calc.subtotal)}</span>
          {calc.service > 0 && <span>· Service {money(calc.service)}</span>}
          {calc.tip > 0 && <span>· Tip {money(calc.tip)}</span>}
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
          placeholder="Item name"
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ flex: 1, fontWeight: 700, fontSize: 15 }}
        />
        <input
          className="inp"
          type="number"
          inputMode="numeric"
          value={item.price || ''}
          placeholder="0"
          onChange={(e) => onPatch({ price: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
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
            {perHead} ea.
          </span>
        </div>
      )}
    </div>
  )
}
