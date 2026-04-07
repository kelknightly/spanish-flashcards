'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type CardDirection = 'es-to-en' | 'en-to-es'

interface CardDirectionContextValue {
  direction: CardDirection
  toggle: () => void
}

const CardDirectionContext = createContext<CardDirectionContextValue>({
  direction: 'es-to-en',
  toggle: () => {},
})

const STORAGE_KEY = 'card-direction'

export function CardDirectionProvider({ children }: { children: React.ReactNode }) {
  const [direction, setDirection] = useState<CardDirection>('es-to-en')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en-to-es') setDirection('en-to-es')
  }, [])

  const toggle = useCallback(() => {
    setDirection((prev) => {
      const next = prev === 'es-to-en' ? 'en-to-es' : 'es-to-en'
      localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return (
    <CardDirectionContext.Provider value={{ direction, toggle }}>
      {children}
    </CardDirectionContext.Provider>
  )
}

export function useCardDirection() {
  return useContext(CardDirectionContext)
}
