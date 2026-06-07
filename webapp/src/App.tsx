import { useCallback, useEffect, useMemo, useState } from 'react'
import { PeopleSheet } from './components/PeopleSheet'
import { useToast } from './components/Toast'
import { SplitScreen } from './screens/SplitScreen'
import { SettleScreen } from './screens/SettleScreen'
import { IncomingScreen } from './screens/IncomingScreen'
import { ActivityScreen } from './screens/ActivityScreen'
import { api, ApiError } from './lib/api'
import { emptyDraft } from './lib/draft'
import type { DraftBill, Person } from './lib/draft'
import { getColorScheme, onThemeChange, haptic } from './lib/telegram'
import type { BillDetail, BillsResponse, Me } from './lib/types'

type Tab = 'split' | 'settle' | 'pay' | 'activity'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'split', label: 'Split', icon: 'ti-receipt-2' },
  { id: 'settle', label: 'Settle', icon: 'ti-arrows-exchange' },
  { id: 'pay', label: 'Pay', icon: 'ti-wallet' },
  { id: 'activity', label: 'Activity', icon: 'ti-history' },
]

export function App() {
  const toast = useToast()
  const [dark, setDark] = useState(() => getColorScheme() === 'dark')
  const [tab, setTab] = useState<Tab>('split')

  const [me, setMe] = useState<Me | null>(null)
  const [contacts, setContacts] = useState<Person[]>([])
  const [bills, setBills] = useState<BillsResponse>({ created: [], incoming: [] })

  const [draft, setDraft] = useState<DraftBill>(emptyDraft)
  const [currentBillId, setCurrentBillId] = useState<string | null>(null)

  const [peopleOpen, setPeopleOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<'unauthorized' | string | null>(null)

  useEffect(() => onThemeChange((s) => setDark(s === 'dark')), [])

  useEffect(() => {
    Promise.all([api.me(), api.contacts(), api.bills()])
      .then(([meRes, contactsRes, billsRes]) => {
        setMe(meRes)
        setContacts(contactsRes.map((c) => ({ id: c.id, name: c.displayName })))
        setBills(billsRes)
      })
      .catch((e) =>
        setFatal(
          e instanceof ApiError && e.status === 401 ? 'unauthorized' : (e as Error).message
        )
      )
      .finally(() => setLoading(false))
  }, [])

  const refresh = useCallback(async () => {
    const [contactsRes, billsRes] = await Promise.all([api.contacts(), api.bills()])
    setContacts(contactsRes.map((c) => ({ id: c.id, name: c.displayName })))
    setBills(billsRes)
  }, [])

  const people: Person[] = useMemo(() => {
    const list: Person[] = []
    if (me) list.push({ id: me.selfContactId, name: 'You' })
    return list.concat(contacts)
  }, [me, contacts])

  const currentBill: BillDetail | null = useMemo(
    () => bills.created.find((b) => b.id === currentBillId) ?? null,
    [bills, currentBillId]
  )

  const toggleParticipant = (id: string) =>
    setDraft((d) =>
      d.participantIds.includes(id)
        ? {
            ...d,
            participantIds: d.participantIds.filter((p) => p !== id),
            items: d.items.map((i) => ({ ...i, who: i.who.filter((w) => w !== id) })),
          }
        : { ...d, participantIds: [...d.participantIds, id] }
    )

  const addContact = async (name: string) => {
    const c = await api.addContact({ displayName: name })
    setContacts((prev) => [...prev, { id: c.id, name: c.displayName }])
    setDraft((d) => ({ ...d, participantIds: [...d.participantIds, c.id] }))
  }

  const newBill = () => {
    setDraft(emptyDraft())
    setCurrentBillId(null)
    setTab('split')
  }

  const send = async () => {
    if (!me) return
    setSending(true)
    try {
      const created = await api.createBill({
        title: draft.title.trim(),
        participantContactIds: draft.participantIds,
        items: draft.items
          .filter((i) => i.price > 0 && i.who.length > 0)
          .map((i) => ({
            name: i.name.trim() || 'Item',
            price: i.price,
            shareContactIds: i.who.filter((w) => draft.participantIds.includes(w)),
          })),
        servicePct: draft.servicePct,
        tip: draft.tip,
      })
      await refresh()
      setCurrentBillId(created.id)
      setDraft(emptyDraft())
      haptic('success')
      toast('Bill sent to participants', 'ti-send')
      setTab('settle')
    } catch (e) {
      haptic('error')
      toast(e instanceof Error ? e.message : 'Could not send bill', 'ti-alert-circle')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="tg-app" data-theme={dark ? 'dark' : 'light'} style={center}>
        <span className="muted" style={{ fontWeight: 600 }}>Loading…</span>
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="tg-app" data-theme={dark ? 'dark' : 'light'} style={center}>
        <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: 32 }}>
          <i className="ti ti-lock" style={{ fontSize: 34, color: 'var(--text-3)' }} />
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            {fatal === 'unauthorized' ? 'Open from Telegram' : 'Something went wrong'}
          </div>
          <div className="muted" style={{ fontSize: 13.5, fontWeight: 600, maxWidth: 260, lineHeight: 1.5 }}>
            {fatal === 'unauthorized'
              ? 'Launch Splitwell from the bot (register with your phone first), then reopen this app.'
              : fatal}
          </div>
        </div>
      </div>
    )
  }

  const subtitle =
    tab === 'split'
      ? draft.title.trim() || 'New bill'
      : tab === 'settle'
        ? currentBill?.title ?? 'Settle up'
        : tab === 'pay'
          ? 'Incoming'
          : 'Activity'

  return (
    <div className="tg-app" data-theme={dark ? 'dark' : 'light'}>
      {/* top bar */}
      <div className="topbar">
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <i className="ti ti-receipt-2" style={{ fontSize: 21, color: 'var(--on-accent)' }} />
        </div>
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-.3px' }}>Splitwell</span>
          <span
            className="muted3"
            style={{
              fontSize: 12,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </span>
        </div>
        <button className="icon-btn" onClick={() => setDark((v) => !v)} title="Toggle theme">
          <i className={'ti ' + (dark ? 'ti-sun' : 'ti-moon')} />
        </button>
        <button className="icon-btn" onClick={newBill} title="New bill">
          <i className="ti ti-plus" />
        </button>
      </div>

      {/* screens */}
      {tab === 'split' && (
        <SplitScreen
          draft={draft}
          setDraft={setDraft}
          people={people}
          onAddPeople={() => setPeopleOpen(true)}
          onSend={send}
          sending={sending}
        />
      )}
      {tab === 'settle' && me && (
        <SettleScreen bill={currentBill} me={me} refresh={refresh} goSplit={newBill} />
      )}
      {tab === 'pay' && <IncomingScreen incoming={bills.incoming} refresh={refresh} />}
      {tab === 'activity' && me && (
        <ActivityScreen
          created={bills.created}
          incoming={bills.incoming}
          me={me}
          openCreated={(b) => {
            setCurrentBillId(b.id)
            setTab('settle')
          }}
          goIncoming={() => setTab('pay')}
        />
      )}

      {/* bottom nav */}
      <div className="tabbar">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            className={'tabbar-item' + (tab === tb.id ? ' on' : '')}
            onClick={() => {
              haptic('light')
              setTab(tb.id)
            }}
          >
            <i className={'ti ' + tb.icon} />
            {tb.label}
          </button>
        ))}
      </div>

      <PeopleSheet
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        people={people}
        selected={draft.participantIds}
        onToggle={toggleParticipant}
        onAddContact={addContact}
      />
    </div>
  )
}

const center = {
  alignItems: 'center',
  justifyContent: 'center',
} as const
