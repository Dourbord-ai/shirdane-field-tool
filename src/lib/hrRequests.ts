// ============================================================
// submitHrRequest
// Thin wrapper around the `submit-hr-request` edge function which
// bridges to the legacy HR API. Forms call this AFTER (or alongside)
// their normal Supabase write so we keep the local audit trail and
// also propagate the request to the legacy HR system.
// ============================================================

import { supabase } from '@/integrations/supabase/client';

export type HrRequestType =
  | 'manual_traffic'
  | 'overtime'
  | 'mission'
  | 'exception_shift'
  | 'leave';

export interface HrRequestArgs {
  type: HrRequestType;
  /** App user id (auth user). Will be used to resolve hr_user_id from hr_profiles. */
  appUserId?: string;
  /** Optional explicit hr_user_id (legacy HR id). Overrides appUserId resolution. */
  hr_user_id?: number | string;
  /** Optional explicit legacy HR username. Overrides appUserId resolution. */
  username?: string;
  payload: Record<string, any>;
}

export interface HrRequestResult {
  success: boolean;
  legacy_status: number | null;
  message?: string;
  error?: string;
  raw?: any;
}

/**
 * Calls the `submit-hr-request` edge function. Never throws — always
 * returns a normalized result object so callers can branch on
 * `.success` and surface `.message` / `.error` to the user.
 */
export async function submitHrRequest(args: HrRequestArgs): Promise<HrRequestResult> {
  try {
    // Resolve hr_user_id from hr_profiles when only the app user id was passed.
    // This mirrors the lookup used by `useHrAttendance` so the legacy HR API
    // receives the correct legacy id even when the app username differs.
    let hrUserId = args.hr_user_id;
    if (!hrUserId && !args.username && args.appUserId) {
      const { data: profile, error: profErr } = await supabase
        .from('hr_profiles')
        .select('hr_user_id')
        .eq('user_id', args.appUserId)
        .maybeSingle();
      if (profErr) {
        return {
          success: false,
          legacy_status: null,
          error: profErr.message || 'خطا در یافتن پروفایل HR',
        };
      }
      if (!profile?.hr_user_id) {
        return {
          success: false,
          legacy_status: null,
          error: 'شناسه کاربر سامانه منابع انسانی برای این حساب تنظیم نشده است.',
        };
      }
      hrUserId = profile.hr_user_id as number;
    }

    const body = {
      type: args.type,
      payload: args.payload,
      ...(hrUserId !== undefined ? { hr_user_id: hrUserId } : {}),
      ...(args.username ? { username: args.username } : {}),
    };

    const { data, error } = await supabase.functions.invoke('submit-hr-request', {
      body,
    });
    if (error) {
      return {
        success: false,
        legacy_status: null,
        error: error.message || 'خطای ارتباط با سامانه HR',
      };
    }
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        legacy_status: null,
        error: 'پاسخ نامعتبر از سامانه HR',
      };
    }
    return data as HrRequestResult;
  } catch (e: any) {
    return {
      success: false,
      legacy_status: null,
      error: e?.message || 'خطای ناشناخته در ارسال درخواست HR',
    };
  }
}

// ============================================================
// Editable enum constants — to be confirmed with HR team
// ============================================================

export const TRAFFIC_TYPE_OPTIONS = [
  { value: 1, label: 'ورود' },
  { value: 0, label: 'خروج' },
] as const;

export const TRAFFIC_FOR_OPTIONS = [
  { value: 1, label: 'فراموشی ثبت تردد' },
  { value: 2, label: 'اصلاح تردد' },
] as const;

export const MISSION_LOCATION_TYPE_OPTIONS = [
  { value: 1, label: 'داخل شهر' },
  { value: 2, label: 'خارج شهر' },
] as const;

export const SHIFT_TYPE_OPTIONS = [
  { value: 1, label: 'تغییر شیفت' },
  { value: 2, label: 'جمعه کاری / شیفت جایگزین' },
] as const;

export const TYPE_OF_FALSE_LEAVE_OPTIONS = [
  { value: 1, label: 'استحقاقی' },
  { value: 2, label: 'استعلاجی' },
  { value: 3, label: 'بدون حقوق' },
  { value: 4, label: 'سایر' },
] as const;
