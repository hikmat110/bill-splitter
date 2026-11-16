# Deferred features — Bill Split Mini App

The Mini App reproduces the `Splitwell.html` design but is trimmed to what the bot
backend currently supports. Everything below appeared in the original design and was
**intentionally left out** of this implementation. Each entry notes where it lived and
what backing it needs before it can be built for real.

> Bot scope is also defined in the root `CLAUDE.md` ("Out of Scope for MVP"). Several
> items here overlap with that list.

## Removed UI features

| Feature | In the design | What it needs to ship |
|---|---|---|
| **Receipt OCR scan** | Split screen "Scan a receipt" card + `ScanSheet` (simulated AI line-item read) | Image upload endpoint + an OCR/LLM pipeline to extract line items & prices. Out of MVP scope. |
| **Cheque OCR + payment records** | The whole `Pay` screen as designed: free-form payments with methods (Payme/Click/Cash/Uzum/Card), partial amounts, "verified" toggles, and AI cheque reading | A `payments` table (amount, method, note, verified, cheque image) and OCR. The bot only tracks per-participant status (`pending → marked_paid → confirmed/disputed`), which is what the reframed **Pay → Incoming** tab uses instead. |
| **Multi-currency** | Currency switch in the Tweaks panel (`so'm / $ / € / ₽`) | Per-bill currency column + FX handling. Bot is UZS-only. UI is fixed to `so'm`. |
| **By-portion / ratio splits** | Item card "By portions" segmented control + per-person ratio steppers | `bill_item_shares` would need a weight/ratio column; `computeSettlement` only does equal per-item splits today. UI keeps equal split only. |
| **Discounts** | `bill.discounts[]` in the prototype data + calc engine | A discounts model + settlement support. Not in the schema. |
| **Tip "proportional" mode** | Tip split toggle (`equal` / `proportional`) | `computeSettlement` splits tip equally only. UI offers tip presets without the mode toggle. |
| **Bill emoji** | Emoji picker on the Split identity card | `bills.emoji` column. UI uses a fixed receipt icon. |
| **Payer selection** | "Paid by" segmented control choosing who fronted the bill | The bot models the **creator** as the payer; others owe their share. UI drops the selector. |
| **Friend-to-friend netting / minimal-transfer settle-up** | Settle screen's bidirectional transfer plan (`settleUp()`) and per-person share message generator | Cross-bill/multi-party netting. The bot is creator-centric (participants owe the creator), so Settle shows "who owes you" + confirm/remind/dispute instead. |
| **Cross-bill running balances** | Activity "Balances with friends" list aggregated across all bills | A balances rollup across bills (CLAUDE.md keeps history per-bill). Activity shows per-bill history + simple owed/owe summary cards computed from outstanding amounts. |

## Removed prototype scaffolding (not product features)

| Item | Notes |
|---|---|
| **iOS device frame** (`IOSDevice`, status bar, home indicator, keyboard) | Mockup chrome only — the real Mini App fills the Telegram viewport. |
| **Tweaks panel** (`useTweaks`, `TweaksPanel`, accent color / density / dark-mode / currency controls) | A design-prototyping tool. Theme is driven by Telegram's color scheme + an in-app light/dark toggle; accent is fixed to coral and density to "cozy". |
| **Demo data + client calc engine** (`makeDemoBill`, `makeHistory`, `computeBill`, `settleUp`) | Replaced by real API data; settlement is computed server-side by `src/utils/settlement.ts`. |

## Notable behavior choices

- **Dispute reason** uses `window.prompt` for now; a custom in-app modal would be nicer
  (Telegram's WebApp API has no native text-input popup).
- **Registration** stays a bot-only flow (phone share). The Mini App returns a friendly
  "open from the bot" screen for unregistered users.
