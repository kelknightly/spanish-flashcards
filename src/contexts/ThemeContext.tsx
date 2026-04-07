'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'glitter' | 'winter' | 'summer'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'glitter',
  setTheme: () => {},
})

function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('glitter')

  useEffect(() => {
    const stored = localStorage.getItem('sf_theme') as Theme | null
    const valid = stored === 'glitter' || stored === 'winter' || stored === 'summer'
    const initial = valid ? stored : 'glitter'
    applyTheme(initial)
    setThemeState(initial)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('sf_theme', t)
    applyTheme(t)
    setThemeState(t)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
