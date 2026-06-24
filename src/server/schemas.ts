// Zod request schemas for the Mini App API. Pure (no DB) — unit-tested.
// Money fields arrive as JS numbers (real 2-decimal som); stored as numeric(14,2).

import { z } from 'zod'

export const createBillItemSchema = z.object({
  name: z.string().trim().max(200).default(''),
  // Positive som; decimals allowed (e.g. 10.33). Empty placeholder rows are
  // filtered client-side before submit.
  price: z.number().positive(),
  shareContactIds: z.array(z.uuid()).min(1),
})

// Image mimes accepted for receipt/proof photos. Mirrors storage.service
// ALLOWED_MIME — keep the two in sync.
export const imageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp'])

export const createBillSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    participantContactIds: z.array(z.uuid()).min(1),
    items: z.array(createBillItemSchema).min(1),
    servicePct: z.number().min(0).max(100).default(0),
    tip: z.number().nonnegative().default(0),
    // Who fronted the tip. Null/absent = the creator (default). When set it must
    // be one of the participants. The creator's own contact is normalized back
    // to null server-side (see mappers.toCreateBillInput).
    tipPaidByContactId: z.uuid().nullish(),
    // Optional main receipt photo: the opaque attachment id returned by
    // POST /api/attachments, plus its mime. Both or neither.
    receiptAttachmentId: z.uuid().nullish(),
    receiptMime: imageMimeSchema.nullish(),
  })
  .superRefine((data, ctx) => {
    // Every item's sharers must be among the bill's participants.
    const participants = new Set(data.participantContactIds)
    data.items.forEach((item, i) => {
      item.shareContactIds.forEach((id) => {
        if (!participants.has(id)) {
          ctx.addIssue({
            code: 'custom',
            message: 'item shares a contact that is not a participant',
            path: ['items', i, 'shareContactIds'],
          })
        }
      })
    })
    if (data.tipPaidByContactId && !participants.has(data.tipPaidByContactId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'tip payer must be one of the participants',
        path: ['tipPaidByContactId'],
      })
    }
    // A receipt reference needs both id and mime (so the file path resolves).
    if (Boolean(data.receiptAttachmentId) !== Boolean(data.receiptMime)) {
      ctx.addIssue({
        code: 'custom',
        message: 'receiptAttachmentId and receiptMime must be provided together',
        path: ['receiptAttachmentId'],
      })
    }
  })

export type CreateBillBody = z.infer<typeof createBillSchema>

// Editing replaces the whole bill, so the PATCH body is the same shape.
export const updateBillSchema = createBillSchema
export type UpdateBillBody = CreateBillBody

// Optional proof-of-transfer attached to a mark-paid request. Both fields are
// optional; a request with no body (or no attachment) just marks paid.
export const markPaidSchema = z.object({
  attachmentId: z.uuid().nullish(),
  mime: imageMimeSchema.nullish(),
})
export type MarkPaidBody = z.infer<typeof markPaidSchema>

// Scan an already-uploaded receipt image (the opaque id + mime returned by
// POST /api/attachments) with Gemini. Mirrors the attachment reference shape.
export const scanReceiptSchema = z.object({
  attachmentId: z.uuid(),
  mime: imageMimeSchema,
})
export type ScanReceiptBody = z.infer<typeof scanReceiptSchema>

export const createContactSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(3).max(32).optional(),
})
export type CreateContactBody = z.infer<typeof createContactSchema>

export const disputeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})
export type DisputeBody = z.infer<typeof disputeSchema>
