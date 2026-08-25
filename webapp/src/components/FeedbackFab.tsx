import { useT } from '../i18n'

/** Floating feedback button, visible on every screen (see .feedback-fab CSS for
 *  the z-index rules). Shows a spinner while the screen capture is running. */
export function FeedbackFab({
  onClick,
  capturing,
}: {
  onClick: () => void
  capturing: boolean
}) {
  const { t } = useT()
  return (
    <button
      className="feedback-fab"
      onClick={onClick}
      disabled={capturing}
      aria-label={t('feedback.title')}
      title={t('feedback.title')}
    >
      <i className={capturing ? 'ti ti-loader-2 spin' : 'ti ti-message-report'} />
    </button>
  )
}
