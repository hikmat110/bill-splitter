import { useCallback, useEffect, useMemo, useState } from 'react'
import { PeopleSheet } from './components/PeopleSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useToast } from './components/Toast'
import { SplitScreen } from './screens/SplitScreen'
import { SettleScreen } from './screens/SettleScreen'
import { IncomingScreen } from './screens/IncomingScreen'
import { ActivityScreen } from './screens/ActivityScreen'
import { api, ApiError } from './lib/api'
import { emptyDraft } from './lib/draft'
import type { DraftBill, Person } from './lib/draft'
import { getColorScheme, onThemeChange, haptic } from './lib/telegram'
import { useT } from './i18n'
import type { BillDetail, BillsResponse, Me } from './lib/types'

type Tab = 'split' | 'settle' | 'pay' | 'activity'

const TABS: { id: Tab; navKey: 'nav.split' | 'nav.settle' | 'nav.pay' | 'nav.activity'; icon: string }[] = [
  { id: 'split', navKey: 'nav.split', icon: 'ti-receipt-2' },
  { id: 'settle', navKey: 'nav.settle', icon: 'ti-arrows-exchange' },
  { id: 'pay', navKey: 'nav.pay', icon: 'ti-wallet' },
  { id: 'activity', navKey: 'nav.activity', icon: 'ti-history' },
]

export function App() {
  const { t, setLang } = useT()
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
        setLang(meRes.languageCode)
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
    if (me) list.push({ id: me.selfContactId, name: t('common.you') })
    return list.concat(contacts)
  }, [me, contacts, t])

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
            name: i.name.trim() || t('split.default_item_name'),
            price: i.price,
            shareContactIds: i.who.filter((w) => draft.participantIds.includes(w)),
          })),
        servicePct: draft.servicePct,
        tip: draft.tip,
        tipPaidByContactId:
          draft.tip > 0 && draft.tipPaidBy && draft.tipPaidBy !== me.selfContactId
            ? draft.tipPaidBy
            : null,
      })
      await refresh()
      setCurrentBillId(created.id)
      setDraft(emptyDraft())
      haptic('success')
      toast(t('app.bill_sent'), 'ti-send')
      setTab('settle')
    } catch (e) {
      haptic('error')
      toast(e instanceof Error ? e.message : t('app.bill_send_failed'), 'ti-alert-circle')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="tg-app" data-theme={dark ? 'dark' : 'light'} style={center}>
        <span className="muted" style={{ fontWeight: 600 }}>{t('common.loading')}</span>
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="tg-app" data-theme={dark ? 'dark' : 'light'} style={center}>
        <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: 32 }}>
          <i className="ti ti-lock" style={{ fontSize: 34, color: 'var(--text-3)' }} />
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            {fatal === 'unauthorized' ? t('app.unauthorized_title') : t('app.error_title')}
          </div>
          <div className="muted" style={{ fontSize: 13.5, fontWeight: 600, maxWidth: 260, lineHeight: 1.5 }}>
            {fatal === 'unauthorized' ? t('app.unauthorized_help') : fatal}
          </div>
        </div>
      </div>
    )
  }

  const subtitle =
    tab === 'split'
      ? draft.title.trim() || t('app.new_bill_subtitle')
      : tab === 'settle'
        ? currentBill?.title ?? t('nav.settle')
        : tab === 'pay'
          ? t('nav.pay')
          : t('nav.activity')

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
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-.3px' }}>Bill Split</span>
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
      </div>

      {/* screens — boundary keeps a single screen's crash from blanking the whole app */}
      <ErrorBoundary resetKey={tab}>
        {tab === 'split' && me && (
          <SplitScreen
            draft={draft}
            setDraft={setDraft}
            people={people}
            selfContactId={me.selfContactId}
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
      </ErrorBoundary>

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
            {t(tb.navKey)}
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
