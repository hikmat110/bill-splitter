import { useCallback, useEffect, useMemo, useState } from 'react'
import { PeopleSheet } from './components/PeopleSheet'
import { AddContactSheet } from './components/AddContactSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useToast } from './components/Toast'
import { SplitScreen } from './screens/SplitScreen'
import { BillsScreen } from './screens/BillsScreen'
import { InboxScreen } from './screens/InboxScreen'
import { BillDetailScreen } from './screens/BillDetailScreen'
import { api, ApiError } from './lib/api'
import { emptyDraft, uid } from './lib/draft'
import type { DraftBill, Person } from './lib/draft'
import { inboxCount } from './lib/billCalc'
import { getColorScheme, onThemeChange, haptic, startParam } from './lib/telegram'
import { useT } from './i18n'
import type { BillDetail, BillsResponse, Me } from './lib/types'

type Tab = 'split' | 'bills' | 'inbox'

const TABS: { id: Tab; navKey: 'nav.split' | 'nav.bills' | 'nav.inbox'; icon: string }[] = [
  { id: 'split', navKey: 'nav.split', icon: 'ti-receipt-2' },
  { id: 'bills', navKey: 'nav.bills', icon: 'ti-list-details' },
  { id: 'inbox', navKey: 'nav.inbox', icon: 'ti-inbox' },
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
  // Bill shown in the full-screen detail overlay (over any tab); null = closed.
  const [detailBillId, setDetailBillId] = useState<string | null>(null)

  const [peopleOpen, setPeopleOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
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

  const [deepLinkDone, setDeepLinkDone] = useState(false)

  const people: Person[] = useMemo(() => {
    const list: Person[] = []
    if (me) list.push({ id: me.selfContactId, name: t('common.you') })
    return list.concat(contacts)
  }, [me, contacts, t])

  // Cached copy for instant overlay paint; BillDetailScreen re-fetches for truth.
  const detailSeed: BillDetail | null = useMemo(
    () => bills.created.find((b) => b.id === detailBillId) ?? null,
    [bills, detailBillId]
  )

  const openBill = useCallback((id: string) => setDetailBillId(id), [])

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

  const addContactByName = async (name: string, phone?: string) => {
    const c = await api.addContact({ displayName: name, phone })
    setContacts((prev) => [...prev, { id: c.id, name: c.displayName }])
    setDraft((d) => ({ ...d, participantIds: [...d.participantIds, c.id] }))
  }

  // Batch-add registered users by @handle, then reload contacts from the server.
  const addContactsByUsername = async (usernames: string) => {
    const result = await api.addContactsByUsername(usernames)
    await refresh()
    return result
  }

  // Load an existing created bill into the Split form for editing (PATCH on send).
  const editBill = useCallback((bill: BillDetail) => {
    setDraft({
      title: bill.title,
      participantIds: bill.participants.map((p) => p.contactId),
      items: bill.items.map((it) => ({
        id: uid(),
        name: it.name,
        price: it.price,
        who: it.shareContactIds,
      })),
      servicePct: bill.servicePct,
      tip: bill.tip,
      tipPaidBy: bill.tipPaidByContactId,
      receiptAttachmentId: bill.receiptAttachmentId,
      receiptMime: bill.receiptMime,
      receiptPreviewUrl: null,
      editingBillId: bill.id,
    })
    setDetailBillId(null)
    setTab('split')
  }, [])

  // Handle `?startapp=` deep links once, after the first load: `edit_<billId>`
  // (the bot's "Edit in app" button) opens the editor while the bill is still
  // editable, else falls back to the detail overlay; `bill_<billId>` opens the
  // detail overlay directly.
  useEffect(() => {
    if (loading || deepLinkDone || !me) return
    setDeepLinkDone(true)
    const param = startParam()
    if (param?.startsWith('edit_')) {
      const bill = bills.created.find((b) => b.id === param.slice('edit_'.length))
      if (!bill) return
      const editable = bill.participants.every(
        (p) => p.linkedUserId === me.id || p.status === 'pending'
      )
      if (editable) editBill(bill)
      else {
        openBill(bill.id)
        toast(t('app.bill_not_editable'), 'ti-alert-circle')
      }
    } else if (param?.startsWith('bill_')) {
      const id = param.slice('bill_'.length)
      const known =
        bills.created.some((b) => b.id === id) ||
        bills.incoming.some((x) => x.bill.id === id)
      if (known) {
        setTab('bills')
        openBill(id)
      }
    }
  }, [loading, deepLinkDone, me, bills, editBill, openBill, t, toast])

  // A contact was deleted: refresh lists and drop them from the working draft.
  const onContactDeleted = useCallback(async (contactId: string) => {
    setDraft((d) => ({
      ...d,
      participantIds: d.participantIds.filter((p) => p !== contactId),
      items: d.items.map((i) => ({ ...i, who: i.who.filter((w) => w !== contactId) })),
    }))
    await refresh()
  }, [refresh])

  const send = async () => {
    if (!me) return
    setSending(true)
    try {
      const payload = {
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
        receiptAttachmentId: draft.receiptAttachmentId,
        receiptMime: draft.receiptMime,
      }
      const editingId = draft.editingBillId
      const saved = editingId
        ? await api.updateBill(editingId, payload)
        : await api.createBill(payload)
      await refresh()
      setDraft(emptyDraft())
      haptic('success')
      toast(t(editingId ? 'app.bill_updated' : 'app.bill_sent'), 'ti-send')
      setTab('bills')
      openBill(saved.id)
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
      : tab === 'bills'
        ? t('nav.bills')
        : t('nav.inbox')

  const badge = me ? inboxCount(bills, me) : 0

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
        {tab === 'bills' && me && (
          <BillsScreen
            created={bills.created}
            incoming={bills.incoming}
            me={me}
            openBill={openBill}
          />
        )}
        {tab === 'inbox' && me && (
          <InboxScreen bills={bills} me={me} refresh={refresh} openBill={openBill} />
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
            {tb.id === 'inbox' && badge > 0 && <span className="tab-badge">{badge}</span>}
          </button>
        ))}
      </div>

      {/* bill detail — full-screen overlay above content and tabbar */}
      {detailBillId && me && (
        <ErrorBoundary resetKey={detailBillId}>
          <BillDetailScreen
            billId={detailBillId}
            me={me}
            seed={detailSeed}
            refresh={refresh}
            onClose={() => setDetailBillId(null)}
            onEdit={editBill}
          />
        </ErrorBoundary>
      )}

      <PeopleSheet
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        people={people}
        selected={draft.participantIds}
        selfContactId={me?.selfContactId ?? null}
        onToggle={toggleParticipant}
        onOpenAdd={() => setAddOpen(true)}
        onDeleted={onContactDeleted}
      />

      <AddContactSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        botUsername={me?.botUsername ?? null}
        onAddByName={addContactByName}
        onAddByUsername={addContactsByUsername}
      />
    </div>
  )
}

const center = {
  alignItems: 'center',
  justifyContent: 'center',
} as const
