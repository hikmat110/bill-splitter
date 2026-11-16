import { AuthImage } from './AuthImage'

/** Fullscreen overlay showing a single protected image. Renders nothing when
 *  `attachmentId` is null. Tap anywhere to dismiss. */
export function PhotoModal({
  attachmentId,
  onClose,
}: {
  attachmentId: string | null
  onClose: () => void
}) {
  if (!attachmentId) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <AuthImage
        attachmentId={attachmentId}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          background: 'transparent',
          borderRadius: 12,
        }}
      />
      <button
        className="icon-btn"
        onClick={onClose}
        style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none' }}
      >
        <i className="ti ti-x" />
      </button>
    </div>
  )
}
