// ============================================================
// useCertificates.ts — Data layer for "مدارک و مجوزها".
// All CRUD + realtime sync + status helper.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { processRenewalTickets } from '@/utils/certificateRenewal';
import jalaali from '@/lib/jalaali';

export type RenewalLeadTime = '1m' | '3m' | '6m' | '1y' | 'custom';

export const RENEWAL_LEAD_TIME_OPTIONS: { value: RenewalLeadTime; label: string; days: number }[] = [
  { value: '1m', label: '۱ ماه قبل از انقضا', days: 30 },
  { value: '3m', label: '۳ ماه قبل از انقضا', days: 90 },
  { value: '6m', label: '۶ ماه قبل از انقضا', days: 180 },
  { value: '1y', label: '۱ سال قبل از انقضا', days: 365 },
  { value: 'custom', label: 'تاریخ مشخص (انتخاب دستی)', days: 0 },
];

export interface CertificateRow {
  id: number;
  title: string;
  doc_type: string;
  issuer: string | null;
  doc_number: string | null;
  issue_date_shamsi: string | null;
  expiry_date_shamsi: string | null;
  description: string | null;
  image_url: string | null;
  attachment_urls: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  renewal_lead_time: RenewalLeadTime | null;
  renewal_ticket_id: number | null;
  renewal_ticket_created_at: string | null;
  renewal_custom_date_shamsi: string | null;
}

export type CertificateInput = Omit<CertificateRow, 'id' | 'created_at' | 'updated_at'>;

export function useCertificates() {
  const [items, setItems] = useState<CertificateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('certificates')
      .select('*')
      .order('created_at', { ascending: false });

    if (err) {
      console.error('Failed to load certificates:', err);
      setError(err.message);
      setItems([]);
    } else {
      setError(null);
      const rows = (data ?? []) as CertificateRow[];
      setItems(rows);
      if (rows.length > 0) {
        processRenewalTickets(rows).catch((e) =>
          console.error('Renewal processor failed:', e)
        );
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('certificates-realtime')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'certificates' }, () => fetchAll())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  const create = useCallback(async (input: CertificateInput) => {
    const { data, error: err } = await supabase
      .from('certificates')
      .insert(input)
      .select()
      .single();
    if (err) throw err;
    return data as CertificateRow;
  }, []);

  const update = useCallback(async (id: number, patch: Partial<CertificateInput>) => {
    const { data, error: err } = await supabase
      .from('certificates')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (err) throw err;
    return data as CertificateRow;
  }, []);

  const remove = useCallback(async (id: number) => {
    const { error: err } = await supabase.from('certificates').delete().eq('id', id);
    if (err) throw err;
  }, []);

  return { items, loading, error, refresh: fetchAll, create, update, remove };
}

// ============================================================
// Status helper.
// ============================================================
export type CertificateStatus = 'none' | 'valid' | 'expiring' | 'expired';

export function getCertificateStatus(
  expiryShamsi: string | null | undefined
): { status: CertificateStatus; daysRemaining: number | null } {
  if (!expiryShamsi) return { status: 'none', daysRemaining: null };
  const parts = expiryShamsi.split('/').map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return { status: 'none', daysRemaining: null };
  }
  const [jy, jm, jd] = parts;
  try {
    const g = jalaali.toGregorian(jy, jm, jd);
    const expiry = new Date(g.gy, g.gm - 1, g.gd);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    const diffMs = expiry.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { status: 'expired', daysRemaining: diffDays };
    if (diffDays <= 30) return { status: 'expiring', daysRemaining: diffDays };
    return { status: 'valid', daysRemaining: diffDays };
  } catch {
    return { status: 'none', daysRemaining: null };
  }
}
