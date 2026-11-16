import { useT } from '../i18n'

/** Bottom-sheet showing the whole bill as plain text in a monospace block, with a
 *  Copy button. Renders nothing when `data` is null. Copying is delegated to the
 *  parent (which owns the toast + haptic). */
export function TextShareModal({
  data,
  onClose,
  onCopy,
}: {
  data: { text: string; hasCard: boolean } | null
  onClose: () => void
  onCopy: (text: string) => void
}) {
  const { t } = useT()
  if (!data) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,.6)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card pop"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 16,
        }}
      >
        <div className="between" style={{ alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 15.5 }}>{t('share.title')}</span>
          <button className="icon-btn" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {t('share.hint')}
        </div>

        <pre
          style={{
            margin: 0,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            background: 'var(--surface-2)',
            borderRadius: 12,
            padding: 12,
            color: 'var(--text)',
            flex: 1,
          }}
        >
          {data.text}
        </pre>

        {!data.hasCard && (
          <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
            {t('share.no_card')}
          </div>
        )}

        <button className="btn btn-block btn-primary btn-lg" onClick={() => onCopy(data.text)}>
          <i className="ti ti-copy" /> {t('share.copy_button')}
        </button>
      </div>
    </div>
  )
}
