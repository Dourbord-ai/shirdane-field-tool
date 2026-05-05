import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface EroticType {
  id: number;
  title: string;
  code: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

const empty: Partial<EroticType> = { title: "", code: "", description: "", sort_order: 0, is_active: true };

export default function FertilityEroticTypes() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<EroticType> | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["fertility_erotic_types_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fertility_erotic_types" as never)
        .select("id, title, code, description, sort_order, is_active")
        .order("sort_order").order("id");
      if (error) throw error;
      return (data ?? []) as EroticType[];
    },
  });

  const save = useMutation({
    mutationFn: async (v: Partial<EroticType>) => {
      if (!v.title?.trim()) throw new Error("عنوان الزامی است");
      const payload = {
        title: v.title.trim(),
        code: v.code?.trim() || null,
        description: v.description?.trim() || null,
        sort_order: Number(v.sort_order) || 0,
        is_active: v.is_active ?? true,
      };
      if (v.id) {
        const { error } = await supabase.from("fertility_erotic_types" as never).update(payload as never).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fertility_erotic_types" as never).insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fertility_erotic_types_admin"] });
      qc.invalidateQueries({ queryKey: ["fertility_erotic_types"] });
      setEditing(null);
      toast.success("ذخیره شد");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (row: EroticType) => {
      const { error } = await supabase
        .from("fertility_erotic_types" as never)
        .update({ is_active: !row.is_active } as never)
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fertility_erotic_types_admin"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="py-6 space-y-4 animate-fade-in" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-heading text-foreground">انواع فحلی</h1>
        <Button onClick={() => setEditing(empty)} className="gap-2">
          <Plus className="w-4 h-4" /> نوع فحلی جدید
        </Button>
      </div>

      <div className="rounded-xl bg-card border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">ترتیب</TableHead>
                <TableHead className="text-right">عنوان</TableHead>
                <TableHead className="text-right">کد</TableHead>
                <TableHead className="text-right">توضیحات</TableHead>
                <TableHead className="text-right">فعال</TableHead>
                <TableHead className="text-right">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.sort_order}</TableCell>
                  <TableCell className="font-medium">{r.title}</TableCell>
                  <TableCell className="text-muted-foreground">{r.code || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-xs truncate">{r.description || "—"}</TableCell>
                  <TableCell><Switch checked={r.is_active} onCheckedChange={() => toggleActive.mutate(r)} /></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} className="gap-1">
                      <Pencil className="w-4 h-4" /> ویرایش
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">موردی ثبت نشده</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>{editing?.id ? "ویرایش نوع فحلی" : "نوع فحلی جدید"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>عنوان *</Label>
                <Input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div>
                <Label>کد</Label>
                <Input value={editing.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              </div>
              <div>
                <Label>توضیحات</Label>
                <Textarea value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} />
              </div>
              <div>
                <Label>ترتیب نمایش</Label>
                <Input type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} />
                <Label>فعال</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>انصراف</Button>
            <Button onClick={() => editing && save.mutate(editing)} disabled={save.isPending}>
              {save.isPending && <Loader2 className="w-4 h-4 animate-spin ml-1" />} ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
