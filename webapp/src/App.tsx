import { useCallback, useEffect, useMemo, useState } from 'react'
import { PeopleSheet } from './components/PeopleSheet'
import { AddContactSheet } from './components/AddContactSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UpdateBanner, useUpdateCheck } from './components/UpdateBanner'
import { FeedbackFab } from './components/FeedbackFab'
import { FeedbackSheet } from './components/FeedbackSheet'
import { useToast } from './components/Toast'
import { SplitScreen } from './screens/SplitScreen'
import { BillsScreen } from './screens/BillsScreen'
import { InboxScreen } from './screens/InboxScreen'
import { BillDetailScreen } from './screens/BillDetailScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { FeedbackAdminScreen } from './screens/FeedbackAdminScreen'
import { api, ApiError } from './lib/api'
import { captureScreen } from './lib/capture'
import { emptyDraft, uid } from './lib/draft'
import type { DraftBill, Person } from './lib/draft'
import { loadDraft, saveDraft, clearDraft, isDraftEmpty } from './lib/draftStorage'
import { hasSeenTour, markTourSeen } from './lib/firstRun'
import { WelcomeTour } from './components/WelcomeTour'
import { inboxCount } from './lib/billCalc'
import { defaultCardId } from './lib/cards'
import {
  getColorScheme,
  getPlatform,
  getTgVersion,
  onThemeChange,
  haptic,
  startParam,
} from './lib/telegram'
import { BUILD } from './lib/version'
import { useT } from './i18n'
import type { BillDetail, BillsResponse, Me } from './lib/types'

type Tab = 'split' | 'bills' | 'inbox' | 'profile'

const TABS: {
  id: Tab
  navKey: 'nav.split' | 'nav.bills' | 'nav.inbox' | 'nav.profile'
  icon: string
}[] = [
  { id: 'split', navKey: 'nav.split', icon: 'ti-receipt-2' },
  { id: 'bills', navKey: 'nav.bills', icon: 'ti-list-details' },
  { id: 'inbox', navKey: 'nav.inbox', icon: 'ti-inbox' },
  { id: 'profile', navKey: 'nav.profile', icon: 'ti-user' },
]

export function App() {
  const { t, lang, setLang } = useT()
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
  // Which surface opened the add-contact sheet — a contact added mid-split
  // joins the draft's participants; one added from Profile must not.
  const [addOpen, setAddOpen] = useState<false | 'split' | 'profile'>(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<'unauthorized' | string | null>(null)
  const [showTour, setShowTour] = useState(false)

  // Feedback widget: the FAB captures the screen first, then opens the sheet.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackShot, setFeedbackShot] = useState<File | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [feedbackAdminOpen, setFeedbackAdminOpen] = useState(false)

  useEffect(() => onThemeChange((s) => setDark(s === 'dark')), [])

  // Above the early returns below — hooks must run unconditionally, and the
  // fatal branch needs the banner most of all.
  const update = useUpdateCheck()

  useEffect(() => {
    Promise.all([api.me(), api.contacts(), api.bills()])
      .then(([meRes, contactsRes, billsRes]) => {
        setMe(meRes)
        setLang(meRes.languageCode)
        setContacts(
          contactsRes.map((c) => ({ id: c.id, name: c.displayName, linkedUserId: c.linkedUserId }))
        )
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
    setContacts(
      contactsRes.map((c) => ({ id: c.id, name: c.displayName, linkedUserId: c.linkedUserId }))
    )
    setBills(billsRes)
  }, [])

  const refreshMe = useCallback(async () => {
    setMe(await api.me())
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
            items: d.items.map((i) => ({ ...i, who: i.who.filter((w) => w.id !== id) })),
          }
        : { ...d, participantIds: [...d.participantIds, id] }
    )

  const addContactByName = async (name: string, phone?: string) => {
    const c = await api.addContact({ displayName: name, phone })
    setContacts((prev) => [...prev, { id: c.id, name: c.displayName, linkedUserId: c.linkedUserId }])
    if (addOpen === 'split') {
      setDraft((d) => ({ ...d, participantIds: [...d.participantIds, c.id] }))
    }
  }

  // Batch-add registered users by @handle, then reload contacts from the server.
  const addContactsByUsername = async (usernames: string) => {
    const result = await api.addContactsByUsername(usernames)
    await refresh()
    return result
  }

  // Add a payment card from the Split form's picker or the Profile tab.
  const addCard = useCallback(async (number: string) => {
    const card = await api.addCard({ number })
    setMe((m) => (m ? { ...m, cards: [...m.cards, card] } : m))
    return card
  }, [])

  // A card was deleted: drop it from the working draft (a new draft falls back
  // to "use my default"; an edit session keeps an explicit "no card" — the
  // default is never silently resurrected), then reload cards (the server may
  // have promoted a new default).
  const onCardDeleted = useCallback(
    async (cardId: string) => {
      setDraft((d) =>
        d.cardId === cardId ? { ...d, cardId: d.editingBillId ? null : undefined } : d
      )
      await refreshMe()
    },
    [refreshMe]
  )

  // Load an existing created bill into the Split form for editing (PATCH on send).
  const editBill = useCallback((bill: BillDetail) => {
    setDraft({
      title: bill.title,
      participantIds: bill.participants.map((p) => p.contactId),
      items: bill.items.map((it) => ({
        id: uid(),
        name: it.name,
        price: it.price,
        qty: it.quantity,
        who: it.shareContactIds.map((id) => ({
          id,
          units: it.unitsByContactId?.[id] ?? null,
        })),
      })),
      servicePct: bill.servicePct,
      tip: bill.tip,
      tipPaidBy: bill.tipPaidByContactId,
      // Explicit: editing a bill whose card was deleted keeps "no card" — the
      // default is never silently resurrected on someone else's behalf.
      cardId: bill.cardId ?? null,
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
  // detail overlay directly. When no edit deep link claims the Split form, a
  // previously stored draft is restored — the deep link wins over the draft.
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
      return
    }
    if (param?.startsWith('bill_')) {
      const id = param.slice('bill_'.length)
      const known =
        bills.created.some((b) => b.id === id) ||
        bills.incoming.some((x) => x.bill.id === id)
      if (known) {
        setTab('bills')
        openBill(id)
      }
    }
    const stored = loadDraft(me.id)
    if (stored && !isDraftEmpty(stored)) {
      // Contacts (and cards) may have been deleted since the draft was written — prune.
      const known = new Set([me.selfContactId, ...contacts.map((c) => c.id)])
      setDraft({
        ...stored,
        participantIds: stored.participantIds.filter((id) => known.has(id)),
        items: stored.items.map((i) => ({ ...i, who: i.who.filter((w) => known.has(w.id)) })),
        tipPaidBy: stored.tipPaidBy && known.has(stored.tipPaidBy) ? stored.tipPaidBy : null,
        cardId:
          typeof stored.cardId === 'string' && !me.cards.some((c) => c.id === stored.cardId)
            ? undefined
            : stored.cardId,
      })
      toast(t('app.draft_restored'), 'ti-file-check')
    }

    // Welcome tour — only on an organic open (a deep link leaves the flag
    // unburned, so the tour still shows on the next normal open), and only for
    // users with no prior activity. A restorable draft or a bill they CREATED
    // means they've used the app before; incoming bills don't count — those
    // arrive passively, possibly before the user ever opened the app.
    if (param?.startsWith('bill_')) return
    if ((stored && !isDraftEmpty(stored)) || bills.created.length > 0) {
      markTourSeen(me.id)
      return
    }
    if (!hasSeenTour(me.id)) setShowTour(true)
  }, [loading, deepLinkDone, me, bills, contacts, editBill, openBill, t, toast])

  // Persist the working draft (debounced). Edit sessions are never persisted —
  // restoring a stale edit later could clobber a bill someone responded to.
  useEffect(() => {
    if (!me || draft.editingBillId) return
    const timer = setTimeout(() => {
      if (isDraftEmpty(draft)) clearDraft(me.id)
      else saveDraft(me.id, draft)
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, me])

  const discardDraft = useCallback(() => {
    setDraft(emptyDraft())
    if (me) clearDraft(me.id)
  }, [me])

  // A contact was deleted: refresh lists and drop them from the working draft.
  const onContactDeleted = useCallback(async (contactId: string) => {
    setDraft((d) => ({
      ...d,
      participantIds: d.participantIds.filter((p) => p !== contactId),
      items: d.items.map((i) => ({ ...i, who: i.who.filter((w) => w.id !== contactId) })),
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
          .map((i) => {
            const who = i.who.filter((w) => draft.participantIds.includes(w.id))
            const units = Object.fromEntries(
              who.filter((w) => w.units != null && w.units > 0).map((w) => [w.id, w.units!])
            )
            return {
              name: i.name.trim() || t('split.default_item_name'),
              price: i.price,
              quantity: Math.max(1, Math.floor(i.qty || 1)),
              shareContactIds: who.map((w) => w.id),
              ...(Object.keys(units).length > 0 ? { unitsByContactId: units } : {}),
            }
          }),
        servicePct: draft.servicePct,
        tip: draft.tip,
        tipPaidByContactId:
          draft.tip > 0 && draft.tipPaidBy && draft.tipPaidBy !== me.selfContactId
            ? draft.tipPaidBy
            : null,
        // Resolve "use my default" locally so the review/preview and the
        // stored bill agree even if the default changes later.
        cardId: draft.cardId === undefined ? defaultCardId(me.cards) : draft.cardId,
        receiptAttachmentId: draft.receiptAttachmentId,
        receiptMime: draft.receiptMime,
      }
      const editingId = draft.editingBillId
      const saved = editingId
        ? await api.updateBill(editingId, payload)
        : await api.createBill(payload)
      await refresh()
      setDraft(emptyDraft())
      clearDraft(me.id)
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
        {/* A bundle stale enough to break against a changed API lands here —
            without this the user has no way out but reinstalling the app. */}
        {update.target && <UpdateBanner onUpdate={update.update} onDismiss={update.dismiss} />}
      </div>
    )
  }

  // Where the user is right now — tagged onto feedback so reports are reproducible.
  const currentScreen = feedbackAdminOpen
    ? 'feedback_admin'
    : showTour
      ? 'tour'
      : detailBillId
        ? 'bill_detail'
        : tab

  const openFeedback = async () => {
    haptic('light')
    setCapturing(true)
    // Capture BEFORE the sheet opens so the sheet isn't in the shot; null on
    // failure — the form still opens, just without a screenshot.
    const shot = await captureScreen()
    setFeedbackShot(shot)
    setFeedbackOpen(true)
    setCapturing(false)
  }

  const subtitle =
    tab === 'split'
      ? draft.title.trim() || t('app.new_bill_subtitle')
      : tab === 'bills'
        ? t('nav.bills')
        : tab === 'inbox'
          ? t('nav.inbox')
          : t('nav.profile')

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
            cards={me.cards}
            onAddCard={addCard}
            onAddPeople={() => setPeopleOpen(true)}
            onSend={send}
            sending={sending}
            onDiscard={discardDraft}
            hasCreatedBills={bills.created.length > 0}
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
        {tab === 'profile' && me && (
          <ProfileScreen
            me={me}
            contacts={contacts}
            onMe={setMe}
            onRefreshMe={refreshMe}
            onAddCard={addCard}
            onCardDeleted={onCardDeleted}
            onOpenAddContact={() => setAddOpen('profile')}
            onContactDeleted={onContactDeleted}
            onOpenFeedbackAdmin={() => setFeedbackAdminOpen(true)}
          />
        )}
      </ErrorBoundary>

      {/* new build available — sits above the tabbar, under any overlay */}
      {update.target && <UpdateBanner onUpdate={update.update} onDismiss={update.dismiss} />}

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

      {/* first-open welcome tour — full-screen overlay */}
      {showTour && me && (
        <WelcomeTour
          onClose={() => {
            markTourSeen(me.id)
            setShowTour(false)
          }}
        />
      )}

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

      {/* admin-only feedback inbox — full-screen overlay */}
      {feedbackAdminOpen && me?.isAdmin && (
        <ErrorBoundary resetKey="feedback-admin">
          <FeedbackAdminScreen onClose={() => setFeedbackAdminOpen(false)} />
        </ErrorBoundary>
      )}

      {/* feedback FAB — floats over every screen (open sheets cover it via the
          scrim); hidden during the tour so it doesn't overlap the walkthrough */}
      {me && !showTour && <FeedbackFab onClick={() => void openFeedback()} capturing={capturing} />}

      <FeedbackSheet
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        screenshot={feedbackShot}
        context={{
          screen: currentScreen,
          buildId: BUILD.buildId,
          platform: getPlatform(),
          tgVersion: getTgVersion(),
          language: lang,
        }}
      />

      <PeopleSheet
        open={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        people={people}
        selected={draft.participantIds}
        selfContactId={me?.selfContactId ?? null}
        onToggle={toggleParticipant}
        onOpenAdd={() => setAddOpen('split')}
        onDeleted={onContactDeleted}
      />

      <AddContactSheet
        open={addOpen !== false}
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
