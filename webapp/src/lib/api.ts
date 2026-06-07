import { getInitData } from './telegram'
import type {
  Me,
  ApiContact,
  BillDetail,
  BillsResponse,
  CreateBillPayload,
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

export const api = {
  me: () => request<Me>('/me'),
  contacts: () => request<ApiContact[]>('/contacts'),
  addContact: (body: { displayName: string; phone?: string }) =>
    request<ApiContact>('/contacts', { method: 'POST', body }),
  bills: () => request<BillsResponse>('/bills'),
  bill: (id: string) => request<BillDetail>(`/bills/${id}`),
  createBill: (body: CreateBillPayload) =>
    request<BillDetail>('/bills', { method: 'POST', body }),
  remind: (billId: string, pid: string) =>
    request<{ ok: boolean }>(`/bills/${billId}/participants/${pid}/remind`, { method: 'POST' }),
  confirm: (billId: string, pid: string) =>
    request<{ ok: boolean }>(`/bills/${billId}/participants/${pid}/confirm`, { method: 'POST' }),
  dispute: (billId: string, pid: string, reason: string) =>
    request<{ ok: boolean }>(`/bills/${billId}/participants/${pid}/dispute`, {
      method: 'POST',
      body: { reason },
    }),
  markPaid: (pid: string) =>
    request<{ ok: boolean }>(`/participants/${pid}/mark_paid`, { method: 'POST' }),
}
