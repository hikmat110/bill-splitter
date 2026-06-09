import { Money } from '../components/Money'
import { AvatarStack } from '../components/Avatar'
import { SecTitle, Empty } from '../components/common'
import { money } from '../lib/currency'
import { prettyDate } from '../lib/date'
import { createdOutstanding, isSelf, paidCount } from '../lib/billCalc'
import { useT } from '../i18n'
import type { BillDetail, IncomingBill, Me } from '../lib/types'

type Row =
  | { kind: 'created'; at: string; bill: BillDetail }
  | { kind: 'incoming'; at: string; item: IncomingBill }

export function ActivityScreen({
  created,
  incoming,
  me,
  openCreated,
  goIncoming,
}: {
  created: BillDetail[]
  incoming: IncomingBill[]
  me: Me
  openCreated: (bill: BillDetail) => void
  goIncoming: () => void
}) {
  const { t } = useT()
  const youreOwed = created.reduce((s, b) => s + createdOutstanding(b, me), 0)
  const youOwe = incoming
    .filter((x) => x.participant.status !== 'confirmed')
    .reduce((s, x) => s + x.participant.amount, 0)

  const rows: Row[] = [
    ...created.map((bill): Row => ({ kind: 'created', at: bill.createdAt, bill })),
    ...incoming.map((item): Row => ({ kind: 'incoming', at: item.bill.createdAt, item })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at))

  return (
    <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
      {/* overall */}
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div className="card pop" style={{ flex: 1, background: 'var(--pos-soft)', border: 'none', padding: '15px 16px' }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--pos-text)',
              textTransform: 'uppercase',
              letterSpacing: '.3px',
            }}
          >
            {t('activity.youre_owed')}
          </span>
          <Money
            amount={youreOwed}
            style={{ display: 'block', fontSize: 23, fontWeight: 800, color: 'var(--pos-text)', marginTop: 3, letterSpacing: '-.5px' }}
          />
        </div>
        <div className="card pop" style={{ flex: 1, background: 'var(--neg-soft)', border: 'none', padding: '15px 16px' }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--neg-text)',
              textTransform: 'uppercase',
              letterSpacing: '.3px',
            }}
          >
            {t('activity.you_owe')}
          </span>
          <Money
            amount={youOwe}
            style={{ display: 'block', fontSize: 23, fontWeight: 800, color: 'var(--neg-text)', marginTop: 3, letterSpacing: '-.5px' }}
          />
        </div>
      </div>

      <SecTitle>{t('activity.history')}</SecTitle>
      {rows.length === 0 ? (
        <Empty icon="ti-history" title={t('activity.no_bills')} sub={t('activity.no_bills_sub')} />
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {rows.map((row) =>
            row.kind === 'created' ? (
              <CreatedRow key={row.bill.id} bill={row.bill} me={me} onClick={() => openCreated(row.bill)} />
            ) : (
              <IncomingRow key={row.item.participant.id} item={row.item} onClick={goIncoming} />
            )
          )}
        </div>
      )}
    </div>
  )
}

function CreatedRow({ bill, me, onClick }: { bill: BillDetail; me: Me; onClick: () => void }) {
  const { t, lang } = useT()
  const outstanding = createdOutstanding(bill, me)
  const { paid, total } = paidCount(bill, me)
  const settled = bill.status === 'settled' || (total > 0 && paid === total)
  const people = bill.participants.map((p) => ({
    id: p.contactId,
    name: isSelf(p, me) ? t('common.you') : p.displayName,
  }))
  return (
    <button onClick={onClick} className="card pop" style={rowStyle}>
      <IconBox />
      <div className="col" style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <div className="row" style={{ gap: 7 }}>
          <span style={titleStyle}>{bill.title}</span>
          <span className="pill pill-acc" style={{ fontSize: 10.5, padding: '1px 7px' }}>{t('activity.sent')}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <AvatarStack people={people} size={22} max={4} />
          <span className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
            {prettyDate(t, lang, bill.createdAt)} · {money(bill.total)}
          </span>
        </div>
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
        {settled ? (
          <span className="pill pill-mut" style={{ fontSize: 11 }}>
            <i className="ti ti-check" style={{ fontSize: 12 }} /> {t('activity.settled')}
          </span>
        ) : (
          <>
            <span className="tnum" style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--pos-text)' }}>
              +{money(outstanding)}
            </span>
            <span className="muted3" style={{ fontSize: 11, fontWeight: 600 }}>
              {t('activity.paid_count', { paid, total })}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

function IncomingRow({ item, onClick }: { item: IncomingBill; onClick: () => void }) {
  const { t, lang } = useT()
  const owed = item.participant.status !== 'confirmed'
  return (
    <button onClick={onClick} className="card pop" style={rowStyle}>
      <IconBox />
      <div className="col" style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <div className="row" style={{ gap: 7 }}>
          <span style={titleStyle}>{item.bill.title}</span>
          <span className="pill pill-mut" style={{ fontSize: 10.5, padding: '1px 7px' }}>{t('activity.received')}</span>
        </div>
        <span className="muted3" style={{ fontSize: 12, fontWeight: 600 }}>
          {t('activity.from', { name: item.bill.creatorName || t('common.friend') })} ·{' '}
          {prettyDate(t, lang, item.bill.createdAt)}
        </span>
      </div>
      <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
        {owed ? (
          <>
            <span className="tnum" style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--neg-text)' }}>
              −{money(item.participant.amount)}
            </span>
            <span className="muted3" style={{ fontSize: 11, fontWeight: 600 }}>{t('activity.you_owe_short')}</span>
          </>
        ) : (
          <span className="pill pill-pos" style={{ fontSize: 11 }}>
            <i className="ti ti-check" style={{ fontSize: 12 }} /> {t('incoming.paid')}
          </span>
        )}
      </div>
    </button>
  )
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 13,
  width: '100%',
  textAlign: 'left' as const,
  cursor: 'pointer',
  padding: 'calc(13px * var(--dens))',
}

const titleStyle = {
  fontWeight: 700,
  fontSize: 14.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
}

function IconBox() {
  return (
    <div
      style={{
        width: 46,
        height: 46,
        borderRadius: 'var(--r)',
        background: 'var(--surface-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <i className="ti ti-receipt-2" style={{ fontSize: 22, color: 'var(--accent)' }} />
    </div>
  )
}
