import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import SearchableSelect from "@/components/SearchableSelect";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { toast } from "sonner";
import { useCows, useFertilityOperations, useFertilityStatuses, cowLabel } from "@/hooks/useFertilityRefs";
import { getSession } from "@/lib/auth";

interface EroticTypeOpt { id: number; title: string }

export default function FertilityOperations() {
  const qc = useQueryClient();
  const { user } = getSession();
  const { data: cows = [] } = useCows();
  const { data: ops = [] } = useFertilityOperations();
  const { data: statuses = [] } = useFertilityStatuses();

  const [cowId, setCowId] = useState<string>("");
  const [opId, setOpId] = useState<string>("1");
  const [dateShamsi, setDateShamsi] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [statusId, setStatusId] = useState<string>("");
  const [resultCode, setResultCode] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [eroticTypeId, setEroticTypeId] = useState<string>("");
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [validationKind, setValidationKind] = useState<"error" | "warning" | null>(null);

  const { data: eroticTypes = [] } = useQuery({
    queryKey: ["fertility_erotic_types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fertility_erotic_types" as never)
        .select("id, title")
        .eq("is_active", true)
        .order("sort_order").order("id");
      if (error) throw error;
      return (data ?? []) as EroticTypeOpt[];
    },
    staleTime: 5 * 60_000,
  });

  const isHeat = Number(opId) === 1;

  const cowOptions = useMemo(
    () => cows.map((c) => ({ value: String(c.id), label: cowLabel(c) })),
    [cows]
  );

  const submit = useMutation({
    mutationFn: async () => {
      if (!cowId) throw new Error("لطفاً دام را انتخاب کنید");
      if (!opId) throw new Error("لطفاً عملیات باروری را انتخاب کنید");
      if (!dateShamsi) throw new Error("لطفاً تاریخ را انتخاب کنید");
      if (Number(opId) === 1 && !eroticTypeId) throw new Error("لطفاً نوع فحلی را انتخاب کنید");

      setValidationMessages([]);
      setValidationKind(null);

      // 1) Server-side allowed check
      const { data: check, error: checkErr } = await supabase.functions.invoke("check-fertility-operation", {
        body: {
          livestock_id: Number(cowId),
          fertility_operation_id: Number(opId),
          event_date: dateShamsi,
          event_time: time || null,
          result_code: resultCode || null,
          fertility_status_id: statusId ? Number(statusId) : null,
          mode: "insert",
        },
      });
      if (checkErr) throw new Error(checkErr.message || "خطا در بررسی مجاز بودن عملیات");

      const msgs: string[] = Array.isArray(check?.messages) ? check.messages : [];

      if (check && check.allowed === false) {
        setValidationMessages(msgs.length ? msgs : ["این عملیات برای دام انتخاب‌شده مجاز نیست"]);
        setValidationKind("error");
        throw new Error(msgs[0] || "این عملیات مجاز نیست");
      }

      if (msgs.length) {
        setValidationMessages(msgs);
        setValidationKind("warning");
      }

      // 2) Insert event
      const op = ops.find((o) => o.id === Number(opId));
      const payload = {
        livestock_id: Number(cowId),
        fertility_operation_id: Number(opId),
        event_type: op?.operation_name || "fertility",
        event_date: dateShamsi,
        event_time: time || null,
        result_code: resultCode || null,
        fertility_status_id: statusId ? Number(statusId) : null,
        notes: note || null,
        operator_name: user?.name || null,
        metadata: { matched_rule_id: check?.matched_rule_id ?? null } as never,
        erotic_type_id: Number(opId) === 1 && eroticTypeId ? Number(eroticTypeId) : null,
      };
      const { error } = await supabase.from("livestock_fertility_events").insert(payload as never);
      if (error) throw error;

      // 3) Update last_fertility_status if provided
      if (statusId) {
        await supabase.from("cows").update({ last_fertility_status: Number(statusId) }).eq("id", Number(cowId));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["livestock_fertility_events"] });
      qc.invalidateQueries({ queryKey: ["cows_for_fertility"] });
      qc.invalidateQueries({ queryKey: ["fertility_timeline"] });
      toast.success("عملیات باروری با موفقیت ثبت شد");
      setStatusId(""); setResultCode(""); setNote(""); setTime(""); setEroticTypeId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <h1 className="text-heading text-foreground">ثبت عملیات باروری</h1>

      <div className="rounded-xl bg-card border border-border p-5 space-y-4">
        <div>
          <Label>دام</Label>
          <SearchableSelect options={cowOptions} value={cowId} onChange={setCowId} placeholder="جستجو و انتخاب دام..." />
        </div>

        <div>
          <Label>عملیات باروری</Label>
          <Select value={opId} onValueChange={setOpId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ops.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isHeat && (
          <div>
            <Label>نوع فحلی *</Label>
            <Select value={eroticTypeId} onValueChange={setEroticTypeId}>
              <SelectTrigger><SelectValue placeholder="انتخاب نوع فحلی" /></SelectTrigger>
              <SelectContent>
                {eroticTypes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div style={{ display: 'none' }}>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>تاریخ</Label>
            <ShamsiDatePicker value={dateShamsi} onChange={setDateShamsi} placeholder="انتخاب تاریخ" />
          </div>
          <div>
            <Label>ساعت</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>وضعیت باروری پس از عملیات (اختیاری)</Label>
          <Select value={statusId} onValueChange={setStatusId}>
            <SelectTrigger><SelectValue placeholder="بدون تغییر" /></SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  <span className="inline-block w-2 h-2 rounded-full ml-2" style={{ background: s.color }} />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>کد نتیجه</Label>
          <Input value={resultCode} onChange={(e) => setResultCode(e.target.value)} maxLength={50} />
        </div>

        <div>
          <Label>یادداشت</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} />
        </div>

        {validationMessages.length > 0 && (
          <Alert variant={validationKind === "error" ? "destructive" : "default"}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {validationKind === "error" ? "عملیات مجاز نیست" : "هشدار"}
            </AlertTitle>
            <AlertDescription>
              <ul className="list-disc pr-5 space-y-1">
                {validationMessages.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Button onClick={() => submit.mutate()} disabled={submit.isPending} className="w-full gap-2 touch-target">
          {submit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          ثبت عملیات
        </Button>
      </div>
    </div>
  );
}
