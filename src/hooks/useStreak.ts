'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

export function useStreak() {
  const { user } = useAuth()
  const [streak, setStreak] = useState(0)

  useEffect(() => {
    if (!user || !supabase) return

    supabase
      .from('user_profiles')
      .select('current_streak, last_active_date')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setStreak(data.current_streak ?? 0)
      })
  }, [user])

  return streak
}
