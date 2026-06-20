import { getInitData } from './telegram'
import type {
  Me,
  ApiContact,
  AttachmentRef,
  BillDetail,
  BillsResponse,
  CreateBillPayload,
  UpdateBillPayload,
} from './types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiError(message, res.status)
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
  me: () => request<Me>('/me'),
  contacts: () => request<ApiContact[]>('/contacts'),
  addContact: (body: { displayName: string; phone?: string }) =>
    request<ApiContact>('/contacts', { method: 'POST', body }),
  bills: () => request<BillsResponse>('/bills'),
  bill: (id: string) => request<BillDetail>(`/bills/${id}`),
  createBill: (body: CreateBillPayload) =>
    request<BillDetail>('/bills', { method: 'POST', body }),
  updateBill: (id: string, body: UpdateBillPayload) =>
    request<BillDetail>(`/bills/${id}`, { method: 'PATCH', body }),
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
}
