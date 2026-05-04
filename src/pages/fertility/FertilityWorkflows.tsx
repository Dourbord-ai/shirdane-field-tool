import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import ShamsiDatePicker from "@/components/ShamsiDatePicker";
import { WORKFLOW_CATEGORIES, categoryLabel } from "@/lib/fertilityRefs";

interface Workflow {
  id: string;
  name: string;
  type: string;
  category: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
}

const empty = (): Partial<Workflow> => ({
  name: "",
  type: "WorkFlowFertilityStatus",
  category: 0,
  start_date: "",
  end_date: "",
  is_active: true,
});

export default function FertilityWorkflows() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Workflow> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ["breeding_workflows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("breeding_workflows")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Workflow[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (w: Partial<Workflow>) => {
      const payload = {
        name: w.name?.trim(),
        type: w.type || "WorkFlowFertilityStatus",
        category: w.category ?? 0,
        start_date: w.start_date || null,
        end_date: w.end_date || null,
        is_active: w.is_active ?? true,
      };
      if (!payload.name) throw new Error("نام ورکفلو الزامی است");
      if (w.id) {
        const { error } = await supabase.from("breeding_workflows").update(payload).eq("id", w.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("breeding_workflows").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["breeding_workflows"] });
      toast.success("ورکفلو ذخیره شد");
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("breeding_workflows").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["breeding_workflows"] });
      toast.success("ورکفلو حذف شد");
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-heading text-foreground">ورکفلو باروری</h1>
        <Button onClick={() => setEditing(empty())} className="gap-2">
          <Plus className="w-4 h-4" /> ورکفلو جدید
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : workflows.length === 0 ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
          ورکفلویی ثبت نشده است
        </div>
      ) : (
        <div className="space-y-3">
          {workflows.map((w) => (
            <div key={w.id} className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-body-lg font-bold text-foreground">{w.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${w.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>
                    {w.is_active ? "فعال" : "غیرفعال"}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {categoryLabel(w.category)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {w.start_date || "—"} تا {w.end_date || "—"}
                </p>
              </div>
              <Button variant="outline" size="icon" onClick={() => setEditing(w)} aria-label="ویرایش">
                <Pencil className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setDeleteId(w.id)} aria-label="حذف">
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "ویرایش ورکفلو" : "ورکفلو جدید"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label>نام ورکفلو</Label>
                <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} />
              </div>
              <div>
                <Label>دسته‌بندی</Label>
                <Select value={String(editing.category ?? 0)} onValueChange={(v) => setEditing({ ...editing, category: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WORKFLOW_CATEGORIES.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>تاریخ شروع</Label>
                  <ShamsiDatePicker value={editing.start_date ?? ""} onChange={(v) => setEditing({ ...editing, start_date: v })} placeholder="انتخاب" />
                </div>
                <div>
                  <Label>تاریخ پایان</Label>
                  <ShamsiDatePicker value={editing.end_date ?? ""} onChange={(v) => setEditing({ ...editing, end_date: v })} placeholder="انتخاب" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label>فعال</Label>
                <Switch checked={editing.is_active ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>انصراف</Button>
            <Button onClick={() => editing && upsert.mutate(editing)} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف ورکفلو</AlertDialogTitle>
            <AlertDialogDescription>
              آیا مطمئن هستید؟ تمام قواعد و شرایط مربوط به این ورکفلو نیز باید جداگانه حذف شوند.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && remove.mutate(deleteId)}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
