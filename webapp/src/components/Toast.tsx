import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type ToastFn = (msg: string, icon?: string) => void

const ToastCtx = createContext<ToastFn>(() => {})

export function useToast(): ToastFn {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; icon: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = useCallback<ToastFn>((msg, icon = 'ti-check') => {
    setToast({ msg, icon })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className={'toast' + (toast ? ' show' : '')}>
        {toast && (
          <>
            <i className={'ti ' + toast.icon} style={{ fontSize: 17 }} /> {toast.msg}
          </>
        )}
      </div>
    </ToastCtx.Provider>
  )
}
