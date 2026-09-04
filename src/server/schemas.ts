// Zod request schemas for the Mini App API. Pure (no DB) — unit-tested.
// Money fields arrive as JS numbers (real 2-decimal som); stored as numeric(14,2).

import { z } from 'zod'
import { parseCardNumber } from '../utils/format'

export const createBillItemSchema = z.object({
  name: z.string().trim().max(200).default(''),
  // Positive som PER UNIT; decimals allowed (e.g. 10.33). The line total is
  // price × quantity. Empty placeholder rows are filtered client-side.
  price: z.number().positive(),
  quantity: z.number().int().min(1).max(999).default(1),
  shareContactIds: z.array(z.uuid()).min(1),
  // Explicit per-person unit counts, keyed by contact id. Sharers absent from
  // the record split the unassigned remainder equally. Omitted/empty = the
  // whole line splits equally (legacy behaviour).
  unitsByContactId: z.record(z.uuid(), z.number().int().min(1)).optional(),
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
    // Card shown to participants for paying. undefined = use the creator's
    // default card (resolved server-side); null = explicitly no card.
    cardId: z.uuid().nullish(),
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
      // Explicit units must belong to sharers and can't exceed the quantity.
      if (item.unitsByContactId) {
        const sharers = new Set(item.shareContactIds)
        let unitsTotal = 0
        for (const [id, units] of Object.entries(item.unitsByContactId)) {
          unitsTotal += units
          if (!sharers.has(id)) {
            ctx.addIssue({
              code: 'custom',
              message: 'units assigned to a contact that does not share the item',
              path: ['items', i, 'unitsByContactId'],
            })
          }
        }
        if (unitsTotal > item.quantity) {
          ctx.addIssue({
            code: 'custom',
            message: 'assigned units exceed the item quantity',
            path: ['items', i, 'unitsByContactId'],
          })
        }
      }
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

// Add a payment card. The number may arrive spaced/dashed; the route re-parses
// it to digits with the same helper.
export const createCardSchema = z.object({
  number: z
    .string()
    .refine((s) => parseCardNumber(s) !== null, 'Card number must be 16 digits'),
  label: z.string().trim().min(1).max(50).optional(),
})
export type CreateCardBody = z.infer<typeof createCardSchema>

// Rename a card (null clears the custom label) and/or make it the default.
// `isDefault: false` is not a state — there is always at most one default and
// no "unset" operation.
export const updateCardSchema = z
  .object({
    label: z.string().trim().min(1).max(50).nullable().optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine((d) => d.label !== undefined || d.isDefault, 'No fields to update')
export type UpdateCardBody = z.infer<typeof updateCardSchema>

// Profile updates from the mini-app — language only (name/username sync from Telegram).
export const updateMeSchema = z.object({
  languageCode: z.enum(['uz', 'ru', 'en']),
})
export type UpdateMeBody = z.infer<typeof updateMeSchema>

export const createContactSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(3).max(32).optional(),
})
export type CreateContactBody = z.infer<typeof createContactSchema>

// Free-text list of Telegram @usernames (comma/space/newline separated), parsed
// server-side with parseUsernameList. Mirrors the bot's paste-multiple flow.
export const addContactsByUsernameSchema = z.object({
  usernames: z.string().trim().min(1).max(500),
})
export type AddContactsByUsernameBody = z.infer<typeof addContactsByUsernameSchema>

export const disputeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})
export type DisputeBody = z.infer<typeof disputeSchema>

// ─── feedback ────────────────────────────────────────────────────────────────

export const feedbackCategorySchema = z.enum(['bug', 'suggestion', 'other'])
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>

export const feedbackStatusSchema = z.enum(['open', 'in_progress', 'resolved'])
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>

// Submit in-app feedback. Attachment ids are opaque server-generated uuids from
// POST /api/attachments — trusted as such (same stance as scanReceiptSchema).
// Context is client-reported and only informational, so it's capped, not parsed.
export const createFeedbackSchema = z
  .object({
    category: feedbackCategorySchema,
    message: z.string().trim().min(1).max(2000),
    attachments: z
      .array(
        z.object({
          attachmentId: z.uuid(),
          mime: imageMimeSchema,
          isAutoCapture: z.boolean().default(false),
        })
      )
      .max(5)
      .default([]),
    context: z.object({
      screen: z.string().trim().max(50),
      buildId: z.string().trim().max(100),
      platform: z.string().trim().max(30),
      tgVersion: z.string().trim().max(20),
      language: z.string().trim().max(10),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.attachments.filter((a) => a.isAutoCapture).length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'at most one attachment may be the auto-capture',
        path: ['attachments'],
      })
    }
  })
export type CreateFeedbackBody = z.infer<typeof createFeedbackSchema>

export const updateFeedbackSchema = z.object({
  status: feedbackStatusSchema,
})
export type UpdateFeedbackBody = z.infer<typeof updateFeedbackSchema>

// ─── admin ───────────────────────────────────────────────────────────────────

// Direct message an admin sends to one user through the bot. Sent with no
// parse_mode, so any text is safe; 4000 stays under Telegram's 4096 cap with
// room for the localized "from the admin" prefix.
export const adminMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
})
export type AdminMessageBody = z.infer<typeof adminMessageSchema>
