// ============================================================
// useHrProfile.ts
// Loads / upserts the current user's HR on-call profile.
// On-call score = number of "yes" answers across the 3 questions
// (range 0..3) → mapped to filled stars in the UI.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface HrProfile {
  id: string;
  user_id: string;
  user_name: string;
  on_call_tickets: boolean;
  on_call_colleagues: boolean;
  on_call_representatives: boolean;
  created_at: string;
  updated_at: string;
}

export function useHrProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<HrProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('hr_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!error) setProfile(data as HrProfile | null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const saveAnswers = useCallback(async (answers: {
    on_call_tickets: boolean;
    on_call_colleagues: boolean;
    on_call_representatives: boolean;
  }) => {
    if (!user?.id) return { success: false };
    setSaving(true);
    const payload = {
      user_id: user.id,
      user_name: user.fullName || user.username,
      ...answers,
    };
    const { data, error } = await supabase
      .from('hr_profiles')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    setSaving(false);
    if (!error && data) {
      setProfile(data as HrProfile);
      return { success: true };
    }
    return { success: false };
  }, [user?.id, user?.fullName, user?.username]);

  const onCallScore = profile
    ? Number(profile.on_call_tickets) + Number(profile.on_call_colleagues) + Number(profile.on_call_representatives)
    : 0;

  return { profile, loading, saving, saveAnswers, reload: load, onCallScore };
}
