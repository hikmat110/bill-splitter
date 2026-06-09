import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles.css'
import { initTelegram } from './lib/telegram'
import { I18nProvider } from './i18n'
import { ToastProvider } from './components/Toast'
import { App } from './App'

initTelegram()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </I18nProvider>
  </StrictMode>
)
