'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'

export type AutosaveResult = {
  versionNumber?: number | null
}

export type UseAutosaveOptions = {
  serialized: string
  enabled?: boolean
  delayMs?: number
  save: (serialized: string) => Promise<AutosaveResult | void>
  onSaved?: (result: AutosaveResult | void, serialized: string) => void
  onError?: (error: unknown, serialized: string) => void
}

export function useAutosave({ serialized, enabled = true, delayMs = 2500, save, onSaved, onError }: UseAutosaveOptions) {
  const baselineRef = useRef(serialized)
  const serializedRef = useRef(serialized)
  const saveRef = useRef(save)
  const onSavedRef = useRef(onSaved)
  const onErrorRef = useRef(onError)
  const timerRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef(false)
  const [status, setStatus] = useState<AutosaveStatus>('saved')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [savedVersion, setSavedVersion] = useState<number | null>(null)

  serializedRef.current = serialized
  saveRef.current = save
  onSavedRef.current = onSaved
  onErrorRef.current = onError

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = undefined
  }, [])

  const markSaved = useCallback((value = serializedRef.current, version?: number | null) => {
    baselineRef.current = value
    setStatus(serializedRef.current === value ? 'saved' : 'unsaved')
    setSavedAt(Date.now())
    if (version !== undefined) setSavedVersion(version)
  }, [])

  const runSave = useCallback(async () => {
    if (!enabled || inFlightRef.current || serializedRef.current === baselineRef.current) return
    const value = serializedRef.current
    let failed = false
    inFlightRef.current = true
    setStatus('saving')
    try {
      const result = await saveRef.current(value)
      baselineRef.current = value
      setStatus(serializedRef.current === value ? 'saved' : 'unsaved')
      setSavedAt(Date.now())
      if (result?.versionNumber != null) setSavedVersion(result.versionNumber)
      onSavedRef.current?.(result, value)
    } catch (error) {
      failed = true
      setStatus('error')
      onErrorRef.current?.(error, value)
    } finally {
      inFlightRef.current = false
      if (!failed && serializedRef.current !== baselineRef.current && enabled) {
        clearTimer()
        timerRef.current = window.setTimeout(() => void runSave(), delayMs)
      }
    }
  }, [clearTimer, delayMs, enabled])

  useEffect(() => {
    if (!enabled) {
      clearTimer()
      return
    }
    if (serialized === baselineRef.current) {
      setStatus((current) => (current === 'saving' ? current : 'saved'))
      return
    }
    setStatus((current) => (current === 'saving' ? current : 'unsaved'))
    clearTimer()
    timerRef.current = window.setTimeout(() => void runSave(), delayMs)
    return clearTimer
  }, [clearTimer, delayMs, enabled, runSave, serialized])

  useEffect(() => clearTimer, [clearTimer])

  const retry = useCallback(() => {
    clearTimer()
    void runSave()
  }, [clearTimer, runSave])

  return {
    status,
    savedAt,
    savedVersion,
    isInFlight: inFlightRef.current,
    markSaved,
    retry,
  }
}
