// Pure mapping from the validated Split-form body to the existing
// `CreateBillInput` shape consumed by `bill.service.createBill`. Unit-tested
// (incl. a round-trip through `computeSettlement` for the money invariant).

import type { CreateBillInput } from '../services/bill.service'
import type { CreateBillBody } from './schemas'

export function toCreateBillInput(body: CreateBillBody, creatorId: string): CreateBillInput {
  const participants = new Set(body.participantContactIds)
  return {
    creatorId,
    title: body.title,
    servicePct: body.servicePct,
    serviceFixed: 0,
    tip: body.tip,
    participantContactIds: [...body.participantContactIds],
    items: body.items.map((item, index) => ({
      name: item.name,
      price: item.price,
      quantity: 1,
      position: index,
      // Defensive: keep only sharers that are participants (schema enforces this too).
      shareContactIds: item.shareContactIds.filter((id) => participants.has(id)),
    })),
  }
}
