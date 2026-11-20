import { useCallback, useEffect, useState } from 'react'
import { getStorageStatus, type StorageStatus } from '../platform/storage'

export function useStorageStatus() {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const refresh = useCallback(() => {
    getStorageStatus().then(setStatus, () => setStatus({ supported: false, persisted: false }))
  }, [])
  useEffect(refresh, [refresh])
  return { status, refresh }
}
