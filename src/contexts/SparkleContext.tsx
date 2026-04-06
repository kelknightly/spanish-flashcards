'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type TriggerBurst = (rect: DOMRect) => void

interface SparkleContextValue {
  /** Called by SparkleCanvas on mount to register its burst implementation. */
  registerBurst: (fn: TriggerBurst) => void
  /** Called by any component to fire a glitter burst along a card's border. */
  triggerBurst: TriggerBurst
  /** Whether glitter effects are paused. */
  paused: boolean
  /** Toggle glitter effects on/off. */
  togglePaused: () => void
}

export const SparkleContext = createContext<SparkleContextValue>({
  registerBurst: () => {},
  triggerBurst: () => {},
  paused: false,
  togglePaused: () => {},
})

export function SparkleProvider({ children }: { children: ReactNode }) {
  const burstRef = useRef<TriggerBurst | null>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)

  const registerBurst = useCallback((fn: TriggerBurst) => {
    burstRef.current = fn
  }, [])

  const togglePaused = useCallback(() => {
    setPaused((p) => {
      pausedRef.current = !p
      return !p
    })
  }, [])

  const triggerBurst = useCallback((rect: DOMRect) => {
    if (pausedRef.current) return
    burstRef.current?.(rect)
  }, [])

  return (
    <SparkleContext.Provider value={{ registerBurst, triggerBurst, paused, togglePaused }}>
      {children}
    </SparkleContext.Provider>
  )
}

export function useSparkle() {
  return useContext(SparkleContext)
}
