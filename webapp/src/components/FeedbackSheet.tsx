import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { Segmented, Field } from './common'
import { useToast } from './Toast'
import { api, ApiError, MAX_UPLOAD } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useT } from '../i18n'
import type { AttachmentRef, FeedbackCategory, FeedbackContext } from '../lib/types'

const MAX_SHOTS = 5

type Shot = { file: File; previewUrl: string; isAutoCapture: boolean }

/**
 * The "leave feedback" form, opened by the floating button from any screen.
 * `screenshot` is the auto-captured shot of the screen the user was on (null
 * when capture failed — the form still works, gallery attach included).
 */
export function FeedbackSheet({
  open,
  onClose,
  screenshot,
  context,
}: {
  open: boolean
  onClose: () => void
  screenshot: File | null
  context: FeedbackContext
}) {
  const { t } = useT()
  const toast = useToast()
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [message, setMessage] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Upload refs survive a failed submit, so a retry re-uploads only what failed.
  const uploadedRef = useRef(new Map<File, AttachmentRef>())

  useEffect(() => {
    if (!open) return
    setCategory('bug')
    setMessage('')
    uploadedRef.current.clear()
    setShots(
      screenshot
        ? [{ file: screenshot, previewUrl: URL.createObjectURL(screenshot), isAutoCapture: true }]
        : []
    )
    // Reset only on open — `screenshot` is set in the same render that opens the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Revoke previews when the sheet closes (or the component unmounts mid-open).
  useEffect(() => {
    if (open) return
    setShots((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.previewUrl))
      return []
    })
  }, [open])

  const addShot = (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_UPLOAD) {
      toast(t('common.photo_too_large'), 'ti-alert-circle')
      return
    }
    setShots((prev) =>
      prev.length >= MAX_SHOTS
        ? prev
        : [...prev, { file, previewUrl: URL.createObjectURL(file), isAutoCapture: false }]
    )
  }

  const removeShot = (index: number) =>
    setShots((prev) => {
      const target = prev[index]
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((_, i) => i !== index)
    })

  const submit = async () => {
    if (!message.trim()) return
    setSubmitting(true)
    try {
      const attachments = []
      for (const s of shots) {
        let ref = uploadedRef.current.get(s.file)
        if (!ref) {
          ref = await api.uploadAttachment(s.file)
          uploadedRef.current.set(s.file, ref)
        }
        attachments.push({ attachmentId: ref.id, mime: ref.mime, isAutoCapture: s.isAutoCapture })
      }
      await api.createFeedback({ category, message: message.trim(), attachments, context })
      haptic('success')
      toast(t('feedback.thanks'), 'ti-heart')
      onClose()
    } catch (e) {
      haptic('error')
      const limited = e instanceof ApiError && e.status === 429
      toast(
        limited ? t('feedback.too_many') : e instanceof Error ? e.message : t('feedback.failed'),
        'ti-alert-circle'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('feedback.title')}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          addShot(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="col" style={{ gap: 14, paddingTop: 8 }}>
        <Segmented
          value={category}
          onChange={setCategory}
          options={[
            { value: 'bug', label: t('feedback.category_bug') },
            { value: 'suggestion', label: t('feedback.category_suggestion') },
            { value: 'other', label: t('feedback.category_other') },
          ]}
        />

        <Field>
          <textarea
            className="inp"
            rows={4}
            maxLength={2000}
            placeholder={t('feedback.message_placeholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{ resize: 'none' }}
          />
        </Field>

        <div className="col" style={{ gap: 6 }}>
          <span className="field-label">{t('feedback.screenshot_label')}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {shots.map((s, i) => (
              <div key={s.previewUrl} style={{ position: 'relative' }}>
                <img
                  src={s.previewUrl}
                  alt=""
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 10,
                    objectFit: 'cover',
                    border: '1px solid var(--border)',
                    display: 'block',
                  }}
                />
                <button
                  onClick={() => removeShot(i)}
                  aria-label={t('common.cancel')}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: 'none',
                    background: 'var(--text)',
                    color: 'var(--bg)',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <i className="ti ti-x" />
                </button>
              </div>
            ))}
            {shots.length < MAX_SHOTS && (
              <button
                onClick={() => fileRef.current?.click()}
                aria-label={t('feedback.attach_more')}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 10,
                  border: '1.5px dashed var(--border-2)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-3)',
                  fontSize: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <i className="ti ti-photo-plus" />
              </button>
            )}
          </div>
        </div>

        <button
          className="btn btn-primary btn-block"
          disabled={!message.trim() || submitting}
          onClick={() => void submit()}
        >
          {submitting ? (
            <>
              <i className="ti ti-loader-2 spin" /> {t('feedback.submitting')}
            </>
          ) : (
            <>
              <i className="ti ti-send" /> {t('feedback.submit')}
            </>
          )}
        </button>
      </div>
    </Sheet>
  )
}
