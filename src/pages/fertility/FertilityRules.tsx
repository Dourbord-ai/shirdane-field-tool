import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useFertilityOperations, useFertilityStatuses } from "@/hooks/useFertilityRefs";
import { CONDITION_TYPES, ConditionType, conditionLabel } from "@/lib/fertilityRefs";

interface Workflow { id: string; name: string }
interface Rule {
  id: string;
  workflow_id: string;
  fertility_operation_id: number;
  rule_order: number;
  title: string;
  description: string | null;
  alert_enabled: boolean;
  alert_group_id: string | null;
  duration_of_credit: number | null;
  is_active: boolean;
}
interface Condition {
  id: string;
  rule_id: string;
  condition_type: string;
  min_value: number | null;
  max_value: number | null;
  bool_value: boolean | null;
  text_value: string | null;
  extra_json: Record<string, unknown>;
}

const emptyRule = (workflow_id: string): Partial<Rule> => ({
  workflow_id,
  fertility_operation_id: 1,
  rule_order: 0,
  title: "",
  description: "",
  alert_enabled: false,
  alert_group_id: "",
  duration_of_credit: null,
  is_active: true,
});

export default function FertilityRules() {
  const qc = useQueryClient();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>("");
  const [editingRule, setEditingRule] = useState<Partial<Rule> | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);
  const [openRuleId, setOpenRuleId] = useState<string | null>(null);

  const { data: ops = [] } = useFertilityOperations();
  const { data: statuses = [] } = useFertilityStatuses();

  const { data: workflows = [] } = useQuery({
    queryKey: ["breeding_workflows_min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breeding_workflows")
        .select("id, name")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Workflow[];
    },
  });

  const { data: rules = [], isLoading: loadingRules } = useQuery({
    queryKey: ["breeding_workflow_rules", selectedWorkflowId],
    enabled: !!selectedWorkflowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breeding_workflow_rules")
        .select("*")
        .eq("workflow_id", selectedWorkflowId)
        .order("rule_order", { ascending: true });
      if (error) throw error;
      return data as Rule[];
    },
  });

  const upsertRule = useMutation({
    mutationFn: async (r: Partial<Rule>) => {
      if (!r.title?.trim()) throw new Error("عنوان قاعده الزامی است");
      const payload = {
        workflow_id: r.workflow_id!,
        fertility_operation_id: r.fertility_operation_id ?? 1,
        rule_order: r.rule_order ?? 0,
        title: r.title.trim(),
        description: r.description || null,
        alert_enabled: r.alert_enabled ?? false,
        alert_group_id: r.alert_group_id || null,
        duration_of_credit: r.duration_of_credit ?? null,
        is_active: r.is_active ?? true,
      };
      if (r.id) {
        const { error } = await supabase.from("breeding_workflow_rules").update(payload).eq("id", r.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("breeding_workflow_rules").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["breeding_workflow_rules", selectedWorkflowId] });
      toast.success("قاعده ذخیره شد");
      setEditingRule(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRule = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("breeding_workflow_rule_conditions").delete().eq("rule_id", id);
      const { error } = await supabase.from("breeding_workflow_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["breeding_workflow_rules", selectedWorkflowId] });
      toast.success("قاعده حذف شد");
      setDeleteRuleId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <h1 className="text-heading text-foreground">تعریف قواعد</h1>

      <div className="rounded-xl bg-card border border-border p-4 space-y-2">
        <Label>انتخاب ورکفلو</Label>
        <Select value={selectedWorkflowId} onValueChange={setSelectedWorkflowId}>
          <SelectTrigger><SelectValue placeholder="یک ورکفلو انتخاب کنید..." /></SelectTrigger>
          <SelectContent>
            {workflows.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {selectedWorkflowId && (
        <>
          <div className="flex justify-end">
            <Button onClick={() => setEditingRule(emptyRule(selectedWorkflowId))} className="gap-2">
              <Plus className="w-4 h-4" /> قاعده جدید
            </Button>
          </div>

          {loadingRules ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : rules.length === 0 ? (
            <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
              قاعده‌ای ثبت نشده است
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((r) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  open={openRuleId === r.id}
                  onToggle={() => setOpenRuleId(openRuleId === r.id ? null : r.id)}
                  onEdit={() => setEditingRule(r)}
                  onDelete={() => setDeleteRuleId(r.id)}
                  opName={ops.find((o) => o.id === r.fertility_operation_id)?.name ?? "—"}
                  statuses={statuses}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={!!editingRule} onOpenChange={(o) => !o && setEditingRule(null)}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule?.id ? "ویرایش قاعده" : "قاعده جدید"}</DialogTitle>
          </DialogHeader>
          {editingRule && (
            <div className="space-y-3">
              <div>
                <Label>عنوان</Label>
                <Input value={editingRule.title ?? ""} onChange={(e) => setEditingRule({ ...editingRule, title: e.target.value })} maxLength={200} />
              </div>
              <div>
                <Label>عملیات باروری</Label>
                <Select value={String(editingRule.fertility_operation_id ?? 1)} onValueChange={(v) => setEditingRule({ ...editingRule, fertility_operation_id: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ops.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>ترتیب</Label>
                  <Input type="number" value={editingRule.rule_order ?? 0} onChange={(e) => setEditingRule({ ...editingRule, rule_order: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>اعتبار (روز)</Label>
                  <Input type="number" value={editingRule.duration_of_credit ?? ""} onChange={(e) => setEditingRule({ ...editingRule, duration_of_credit: e.target.value === "" ? null : Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label>توضیحات</Label>
                <Textarea value={editingRule.description ?? ""} onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })} rows={2} />
              </div>
              <div>
                <Label>شناسه گروه هشدار</Label>
                <Input value={editingRule.alert_group_id ?? ""} onChange={(e) => setEditingRule({ ...editingRule, alert_group_id: e.target.value })} maxLength={100} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label>هشدار فعال</Label>
                <Switch checked={editingRule.alert_enabled ?? false} onCheckedChange={(v) => setEditingRule({ ...editingRule, alert_enabled: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label>قاعده فعال</Label>
                <Switch checked={editingRule.is_active ?? true} onCheckedChange={(v) => setEditingRule({ ...editingRule, is_active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRule(null)}>انصراف</Button>
            <Button onClick={() => editingRule && upsertRule.mutate(editingRule)} disabled={upsertRule.isPending}>
              {upsertRule.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRuleId} onOpenChange={(o) => !o && setDeleteRuleId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف قاعده</AlertDialogTitle>
            <AlertDialogDescription>تمام شرایط مربوط به این قاعده نیز حذف خواهند شد.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteRuleId && removeRule.mutate(deleteRuleId)}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ───────────── Rule Card with Conditions ─────────────

function RuleCard({
  rule, open, onToggle, onEdit, onDelete, opName, statuses,
}: {
  rule: Rule; open: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
  opName: string; statuses: { id: number; name: string; color: string }[];
}) {
  return (
    <div className="rounded-xl bg-card border border-border">
      <div className="p-4 flex items-center gap-3">
        <button onClick={onToggle} className="flex-1 min-w-0 text-right" aria-label="باز/بستن شرایط">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-body-lg font-bold text-foreground">{rule.title}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${rule.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>
              {rule.is_active ? "فعال" : "غیرفعال"}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">{opName}</span>
            {rule.alert_enabled && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">هشدار فعال</span>
            )}
          </div>
          {rule.description && <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>}
        </button>
        <Button variant="outline" size="icon" onClick={onToggle} aria-label="شرایط">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
        <Button variant="outline" size="icon" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
        <Button variant="outline" size="icon" onClick={onDelete}><Trash2 className="w-4 h-4 text-destructive" /></Button>
      </div>
      {open && <ConditionsEditor ruleId={rule.id} statuses={statuses} />}
    </div>
  );
}

function ConditionsEditor({ ruleId, statuses }: { ruleId: string; statuses: { id: number; name: string; color: string }[] }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<Condition>>({ condition_type: "Weight", extra_json: {} });

  const { data: conds = [], isLoading } = useQuery({
    queryKey: ["rule_conditions", ruleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breeding_workflow_rule_conditions")
        .select("*")
        .eq("rule_id", ruleId)
        .order("created_at");
      if (error) throw error;
      return data as Condition[];
    },
  });

  const addCond = useMutation({
    mutationFn: async (c: Partial<Condition>) => {
      const payload = {
        rule_id: ruleId,
        condition_type: c.condition_type!,
        min_value: c.min_value ?? null,
        max_value: c.max_value ?? null,
        bool_value: c.bool_value ?? null,
        text_value: c.text_value ?? null,
        extra_json: c.extra_json ?? {},
      };
      const { error } = await supabase.from("breeding_workflow_rule_conditions").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rule_conditions", ruleId] });
      toast.success("شرط اضافه شد");
      setAdding(false);
      setDraft({ condition_type: "Weight", extra_json: {} });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delCond = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("breeding_workflow_rule_conditions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rule_conditions", ruleId] }),
  });

  const meta = CONDITION_TYPES.find((t) => t.type === draft.condition_type)!;

  return (
    <div className="border-t border-border p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-foreground">شرایط</h4>
        {!adding && <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1"><Plus className="w-3 h-3" /> افزودن شرط</Button>}
      </div>

      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-primary mx-auto" />
      ) : conds.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground text-center py-2">شرطی ثبت نشده</p>
      ) : (
        <div className="space-y-2">
          {conds.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg bg-card border border-border p-2 text-xs">
              <span className="font-bold text-foreground">{conditionLabel(c.condition_type)}</span>
              <span className="text-muted-foreground flex-1">{summarizeCondition(c, statuses)}</span>
              <Button variant="ghost" size="icon" onClick={() => delCond.mutate(c.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="rounded-lg bg-card border border-border p-3 space-y-2">
          <div>
            <Label className="text-xs">نوع شرط</Label>
            <Select value={draft.condition_type} onValueChange={(v) => setDraft({ condition_type: v as ConditionType, extra_json: {} })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITION_TYPES.map((t) => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {(meta.kind === "range" || meta.kind === "days") && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">حداقل</Label>
                <Input type="number" value={draft.min_value ?? ""} onChange={(e) => setDraft({ ...draft, min_value: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
              <div>
                <Label className="text-xs">حداکثر</Label>
                <Input type="number" value={draft.max_value ?? ""} onChange={(e) => setDraft({ ...draft, max_value: e.target.value === "" ? null : Number(e.target.value) })} />
              </div>
            </div>
          )}

          {meta.kind === "bool" && (
            <div className="flex items-center justify-between rounded-lg border border-border p-2">
              <Label className="text-xs">مقدار</Label>
              <Switch checked={draft.bool_value ?? false} onCheckedChange={(v) => setDraft({ ...draft, bool_value: v })} />
            </div>
          )}

          {meta.kind === "milkRecord" && (
            <div>
              <Label className="text-xs">تعداد دوره رکوردگیری</Label>
              <Input type="number" value={(draft.extra_json?.count_of_period_milk_record as number) ?? ""}
                onChange={(e) => setDraft({ ...draft, extra_json: { ...draft.extra_json, count_of_period_milk_record: Number(e.target.value) } })} />
            </div>
          )}

          {meta.kind === "fertilityStatus" && (
            <div>
              <Label className="text-xs">وضعیت‌های باروری</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {statuses.map((s) => {
                  const ids = (draft.extra_json?.status_ids as number[]) ?? [];
                  const active = ids.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        const next = active ? ids.filter((x) => x !== s.id) : [...ids, s.id];
                        setDraft({ ...draft, extra_json: { ...draft.extra_json, status_ids: next } });
                      }}
                      className={`text-xs px-2 py-1 rounded-full border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                      style={active ? undefined : { borderColor: s.color }}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => { setAdding(false); setDraft({ condition_type: "Weight", extra_json: {} }); }}>انصراف</Button>
            <Button size="sm" onClick={() => addCond.mutate(draft)} disabled={addCond.isPending}>افزودن</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function summarizeCondition(c: Condition, statuses: { id: number; name: string }[]): string {
  if (c.condition_type === "FertilityStatus") {
    const ids = (c.extra_json?.status_ids as number[]) ?? [];
    return ids.map((id) => statuses.find((s) => s.id === id)?.name ?? id).join("، ") || "—";
  }
  if (c.condition_type === "MilkRecord") {
    return `تعداد دوره: ${c.extra_json?.count_of_period_milk_record ?? "—"}`;
  }
  if (c.bool_value !== null && c.bool_value !== undefined) {
    return c.bool_value ? "بله" : "خیر";
  }
  if (c.min_value !== null || c.max_value !== null) {
    return `از ${c.min_value ?? "—"} تا ${c.max_value ?? "—"}`;
  }
  return "—";
}
