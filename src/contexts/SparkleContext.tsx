'use client'

import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react'

type TriggerBurst = (rect: DOMRect) => void

interface SparkleContextValue {
  /** Called by SparkleCanvas on mount to register its burst implementation. */
  registerBurst: (fn: TriggerBurst) => void
  /** Called by any component to fire a glitter burst along a card's border. */
  triggerBurst: TriggerBurst
}

export const SparkleContext = createContext<SparkleContextValue>({
  registerBurst: () => {},
  triggerBurst: () => {},
})

export function SparkleProvider({ children }: { children: ReactNode }) {
  const burstRef = useRef<TriggerBurst | null>(null)

  const registerBurst = useCallback((fn: TriggerBurst) => {
    burstRef.current = fn
  }, [])

  const triggerBurst = useCallback((rect: DOMRect) => {
    burstRef.current?.(rect)
  }, [])

  return (
    <SparkleContext.Provider value={{ registerBurst, triggerBurst }}>
      {children}
    </SparkleContext.Provider>
  )
}

export function useSparkle() {
  return useContext(SparkleContext)
}
