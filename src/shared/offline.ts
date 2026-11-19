import { useEffect, useState } from 'react'

export function useOfflineStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    const worker = navigator.serviceWorker
    const controlled = () => setReady(Boolean(worker?.controller))
    worker?.addEventListener('controllerchange', controlled)
    controlled()
    if (worker && import.meta.env.PROD) {
      void worker.register('/sw.js').catch(() => setFailed(true))
    } else {
      setFailed(true)
    }
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      worker?.removeEventListener('controllerchange', controlled)
    }
  }, [])

  return { online, ready, failed }
}
