import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Empty } from './common'

// A single screen throwing during render used to unmount the entire React root,
// leaving a blank page (topbar, content and tab bar all gone). This boundary
// contains the failure to the screen area: it shows a recoverable error card and
// logs the real error so the underlying cause is visible instead of silent.

interface Props {
  children: ReactNode
  // Changing this (e.g. the active tab) clears the error so navigating away from
  // a broken screen and back re-attempts the render.
  resetKey?: unknown
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen render error:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="tg-scroll" style={{ padding: '4px 16px 24px' }}>
        <Empty
          icon="ti-alert-triangle"
          title="Something went wrong"
          sub={error.message || 'This screen failed to load.'}
        />
        <button className="btn btn-block btn-soft btn-lg" onClick={() => location.reload()}>
          <i className="ti ti-refresh" /> Reload
        </button>
      </div>
    )
  }
}
