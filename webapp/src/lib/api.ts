import { getInitData } from './telegram'
import type {
  Me,
  ApiContact,
  AttachmentRef,
  BillDetail,
  BillsResponse,
  CreateBillPayload,
  CreateFeedbackPayload,
  FeedbackCategory,
  FeedbackItem,
  FeedbackListResponse,
  FeedbackStatus,
  ScannedReceipt,
  UpdateBillPayload,
  UserCard,
  UsernameAddResult,
} from './types'

const BASE = '/api'

/** Matches the server's MAX_UPLOAD_BYTES default — checked client-side for fast feedback. */
export const MAX_UPLOAD = 5_000_000

export class ApiError extends Error {
  status: number
  /** Parsed JSON error body, when the server sent one (e.g. blockingBills on 409). */
  data: unknown
  constructor(message: string, status: number, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const hasBody = options.body !== undefined
  const res = await fetch(BASE + path, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `tma ${getInitData()}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    let message = `Request failed (${res.status})`
    let data: unknown
    try {
      data = await res.json()
      const err = (data as { error?: string })?.error
      if (err) message = err
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(message, res.status, data)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Upload an image (multipart). Browser sets the multipart Content-Type/boundary,
 *  so unlike request() we must NOT set it ourselves. */
async function uploadAttachment(file: File): Promise<AttachmentRef> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(BASE + '/attachments', {
    method: 'POST',
    headers: { Authorization: `tma ${getInitData()}` },
    body: form,
  })
  if (!res.ok) {
    let message = `Upload failed (${res.status})`
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // keep generic message
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as AttachmentRef
}

/** Fetch a protected image and return an object URL. Caller must revoke it. */
async function fileObjectUrl(id: string): Promise<string> {
  const res = await fetch(BASE + `/files/${id}`, {
    headers: { Authorization: `tma ${getInitData()}` },
  })
  if (!res.ok) throw new ApiError(`Image failed (${res.status})`, res.status)
  return URL.createObjectURL(await res.blob())
}

export const api = {
  uploadAttachment,
  fileObjectUrl,
  scanReceipt: (attachmentId: string, mime: string) =>
    request<ScannedReceipt>('/receipts/scan', { method: 'POST', body: { attachmentId, mime } }),
  me: () => request<Me>('/me'),
  updateMe: (body: { languageCode: 'uz' | 'ru' | 'en' }) =>
    request<Me>('/me', { method: 'PATCH', body }),
  addCard: (body: { number: string; label?: string }) =>
    request<UserCard>('/cards', { method: 'POST', body }),
  updateCard: (id: string, body: { label?: string | null; isDefault?: true }) =>
    request<UserCard>(`/cards/${id}`, { method: 'PATCH', body }),
  deleteCard: (id: string) => request<{ ok: boolean }>(`/cards/${id}`, { method: 'DELETE' }),
  contacts: () => request<ApiContact[]>('/contacts'),
  addContact: (body: { displayName: string; phone?: string }) =>
    request<ApiContact>('/contacts', { method: 'POST', body }),
  addContactsByUsername: (usernames: string) =>
    request<UsernameAddResult>('/contacts/by-username', {
      method: 'POST',
      body: { usernames },
    }),
  deleteContact: (id: string, opts?: { force?: boolean }) =>
    request<{ ok: boolean }>(`/contacts/${id}${opts?.force ? '?force=1' : ''}`, {
      method: 'DELETE',
    }),
  bills: () => request<BillsResponse>('/bills'),
  bill: (id: string) => request<BillDetail>(`/bills/${id}`),
  createBill: (body: CreateBillPayload) =>
    request<BillDetail>('/bills', { method: 'POST', body }),
  updateBill: (id: string, body: UpdateBillPayload) =>
    request<BillDetail>(`/bills/${id}`, { method: 'PATCH', body }),
  deleteBill: (id: string) => request<{ ok: boolean }>(`/bills/${id}`, { method: 'DELETE' }),
  archiveBill: (id: string) =>
    request<BillDetail>(`/bills/${id}/archive`, { method: 'POST' }),
  unarchiveBill: (id: string) =>
    request<BillDetail>(`/bills/${id}/unarchive`, { method: 'POST' }),
  remind: (billId: string, pid: string) =>
    request<{ ok: boolean }>(`/bills/${billId}/participants/${pid}/remind`, { method: 'POST' }),
  confirm: (billId: string, pid: string) =>
    request<{ ok: boolean }>(`/bills/${billId}/participants/${pid}/confirm`, { method: 'POST' }),
  dispute: (billId: string, pid: string, reason: string) =>
    request<{ ok: boolean }>(`/bills/${billId}/participants/${pid}/dispute`, {
      method: 'POST',
      body: { reason },
    }),
  markPaid: (pid: string, proof?: { attachmentId: string; mime: string }) =>
    request<{ ok: boolean }>(`/participants/${pid}/mark_paid`, {
      method: 'POST',
      ...(proof ? { body: proof } : {}),
    }),
  createFeedback: (body: CreateFeedbackPayload) =>
    request<{ id: string }>('/feedback', { method: 'POST', body }),
  feedbackList: (opts: {
    status?: FeedbackStatus
    category?: FeedbackCategory
    offset?: number
    limit?: number
  }) => {
    const params = new URLSearchParams()
    if (opts.status) params.set('status', opts.status)
    if (opts.category) params.set('category', opts.category)
    if (opts.offset) params.set('offset', String(opts.offset))
    if (opts.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return request<FeedbackListResponse>(`/feedback${qs ? `?${qs}` : ''}`)
  },
  updateFeedbackStatus: (id: string, status: FeedbackStatus) =>
    request<FeedbackItem>(`/feedback/${id}`, { method: 'PATCH', body: { status } }),
}
