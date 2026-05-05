'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export function useStreak() {
  const { user } = useAuth()
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    if (!user) return
    fetch('/api/streak')
      .then((r) => r.json())
      .then((data) => { if (typeof data.streak === 'number') setStreak(data.streak) })
      .catch(() => {})
  }, [user])

  return streak
}
