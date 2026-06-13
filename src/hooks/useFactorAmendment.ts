// =============================================================================
// hooks/useFactorAmendment.ts
// -----------------------------------------------------------------------------
// useAmendmentByFactor  — بارگذاری آخرین اصلاح فعال یک فاکتور
// useCreateAmendment    — شروع فرآیند اصلاح (ساخت draft)
// useUpdateAmendmentItems — ذخیره تغییرات آیتم‌ها در پیش‌نویس
// useSubmitAmendment    — ارسال برای بررسی مدیر
// useApproveAmendment   — تأیید نهایی توسط مدیر
// useRejectAmendment    — رد درخواست اصلاح
// =============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AmendmentRow, AmendmentItemRow } from "@/lib/finance/amendment";

// ---------------------------------------------------------------------------
// Query Key Factory
// ---------------------------------------------------------------------------

export const amendmentKeys = {
  all:       ["factor_amendments"] as const,
  byFactor:  (factorId: string) => [...amendmentKeys.all, "factor", factorId] as const,
  one:       (id: string)       => [...amendmentKeys.all, "one", id]          as const,
};

// ---------------------------------------------------------------------------
// SELECT string
// ---------------------------------------------------------------------------

const AMENDMENT_SELECT = `
  id, factor_id, status, reason,
  requested_by, requested_at,
  reviewed_by, reviewed_at, rejection_reason,
  reversal_voucher_id, new_voucher_id,
  created_at, updated_at,
  factor:factors!factor_id(
    invoice_number, invoice_type, total_amount, lifecycle_state
  ),
  items:factor_amendment_items(
    id, amendment_id, factor_item_id, action,
    product_type, quantity, unit, unit_price,
    discount_amount, tax_amount, total_amount,
    description, account_code, cost_center,
    original_quantity, original_unit_price, original_total_amount
  )
`;

// ---------------------------------------------------------------------------
// 1. بارگذاری آخرین اصلاح یک فاکتور
// ---------------------------------------------------------------------------

export function useAmendmentByFactor(factorId: string | null) {
  return useQuery({
    queryKey: amendmentKeys.byFactor(factorId ?? ""),
    enabled: !!factorId,
    queryFn: async (): Promise<AmendmentRow | null> => {
      const { data, error } = await supabase
        .from("factor_amendments")
        .select(AMENDMENT_SELECT)
        .eq("factor_id", factorId!)
        .in("status", ["draft", "review"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as AmendmentRow | null;
    },
  });
}

// ---------------------------------------------------------------------------
// 2. شروع فرآیند اصلاح — ساخت draft جدید
// ---------------------------------------------------------------------------

interface CreateAmendmentInput {
  factorId: string;
  reason: string;
  /** آیتم‌های فاکتور اصلی که به عنوان پیش‌نویس کپی می‌شوند */
  initialItems: Omit<AmendmentItemRow, "id" | "amendment_id">[];
}

export function useCreateAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ factorId, reason, initialItems }: CreateAmendmentInput) => {
      // ۱. ساخت سطر اصلاح
      const { data: amendment, error: aErr } = await supabase
        .from("factor_amendments")
        .insert({ factor_id: factorId, reason, status: "draft" })
        .select("id")
        .single();
      if (aErr) throw aErr;

      // ۲. درج آیتم‌های اولیه (کپی از فاکتور اصلی)
      if (initialItems.length > 0) {
        const rows = initialItems.map((item) => ({
          ...item,
          amendment_id: amendment.id,
        }));
        const { error: iErr } = await supabase
          .from("factor_amendment_items")
          .insert(rows);
        if (iErr) throw iErr;
      }

      return amendment.id as string;
    },
    onSuccess: (_, { factorId }) => {
      qc.invalidateQueries({ queryKey: amendmentKeys.byFactor(factorId) });
    },
  });
}

// ---------------------------------------------------------------------------
// 3. ذخیره تغییرات آیتم‌ها در پیش‌نویس
// ---------------------------------------------------------------------------

interface UpdateItemsInput {
  amendmentId: string;
  factorId: string;
  items: Omit<AmendmentItemRow, "id" | "amendment_id">[];
}

export function useUpdateAmendmentItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ amendmentId, items }: UpdateItemsInput) => {
      // حذف آیتم‌های قدیمی و درج جدید (upsert ساده)
      const { error: delErr } = await supabase
        .from("factor_amendment_items")
        .delete()
        .eq("amendment_id", amendmentId);
      if (delErr) throw delErr;

      if (items.length > 0) {
        const rows = items.map((item) => ({ ...item, amendment_id: amendmentId }));
        const { error: insErr } = await supabase
          .from("factor_amendment_items")
          .insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_, { factorId }) => {
      qc.invalidateQueries({ queryKey: amendmentKeys.byFactor(factorId) });
    },
  });
}

// ---------------------------------------------------------------------------
// 4. ارسال برای بررسی مدیر
// ---------------------------------------------------------------------------

export function useSubmitAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ amendmentId, factorId }: { amendmentId: string; factorId: string }) => {
      const { error } = await supabase
        .from("factor_amendments")
        .update({ status: "review" })
        .eq("id", amendmentId)
        .eq("status", "draft");
      if (error) throw error;
      return factorId;
    },
    onSuccess: (factorId) => {
      qc.invalidateQueries({ queryKey: amendmentKeys.byFactor(factorId) });
    },
  });
}

// ---------------------------------------------------------------------------
// 5. تأیید نهایی توسط مدیر
// ---------------------------------------------------------------------------

export function useApproveAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ amendmentId, factorId }: { amendmentId: string; factorId: string }) => {
      const { error } = await supabase
        .from("factor_amendments")
        .update({ status: "approved", reviewed_at: new Date().toISOString() })
        .eq("id", amendmentId)
        .eq("status", "review");
      if (error) throw error;
      return factorId;
    },
    onSuccess: (factorId) => {
      qc.invalidateQueries({ queryKey: amendmentKeys.byFactor(factorId) });
      qc.invalidateQueries({ queryKey: ["factors"] });
    },
  });
}

// ---------------------------------------------------------------------------
// 6. رد درخواست اصلاح
// ---------------------------------------------------------------------------

export function useRejectAmendment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      amendmentId,
      factorId,
      rejectionReason,
    }: {
      amendmentId: string;
      factorId: string;
      rejectionReason: string;
    }) => {
      const { error } = await supabase
        .from("factor_amendments")
        .update({
          status: "rejected",
          rejection_reason: rejectionReason,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", amendmentId)
        .eq("status", "review");
      if (error) throw error;
      return factorId;
    },
    onSuccess: (factorId) => {
      qc.invalidateQueries({ queryKey: amendmentKeys.byFactor(factorId) });
    },
  });
}

