import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, Pencil, RotateCcw, Search } from "lucide-react";

export type SelectOption = { value: string | number; label: string };

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "boolean" | "select";
  required?: boolean;
  options?: SelectOption[];
  /** Async loader for select options. */
  loadOptions?: () => Promise<SelectOption[]>;
  /** Display formatter for list cell. */
  format?: (row: any) => string;
};

interface Props {
  title: string;
  table: string;
  fields: FieldDef[];
  /** Columns to show in list. Defaults to all field keys. */
  listColumns?: string[];
  /** Extra select to embed (e.g. relations). */
  selectExtra?: string;
}

type Filter = "active" | "deleted";

export default function SoftDeleteCrudTable({
  title,
  table,
  fields,
  listColumns,
  selectExtra,
}: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [sortBy, setSortBy] = useState<"name" | "created_at">("name");
  const [confirm, setConfirm] = useState<{ row: any; mode: "delete" | "restore" } | null>(null);
  const [optionsMap, setOptionsMap] = useState<Record<string, SelectOption[]>>({});

  const cols = listColumns ?? fields.map((f) => f.key);

  async function load() {
    setLoading(true);
    const sel = ["id", "is_active", "is_deleted", "created_at", ...fields.map((f) => f.key), selectExtra]
      .filter(Boolean)
      .join(", ");
    let q = (supabase as any)
      .from(table)
      .select(sel)
      .eq("is_deleted", filter === "deleted")
      .order(sortBy, { ascending: sortBy === "name" })
      .limit(1000);
    const { data, error } = await q;
    if (error) {
      toast.error("خطا در دریافت اطلاعات", { description: error.message });
      setRows([]);
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, sortBy]);

  // Load async select options
  useEffect(() => {
    fields.forEach(async (f) => {
      if (f.type === "select" && f.loadOptions && !optionsMap[f.key]) {
        try {
          const opts = await f.loadOptions();
          setOptionsMap((m) => ({ ...m, [f.key]: opts }));
        } catch (_) {
          /* noop */
        }
      } else if (f.type === "select" && f.options && !optionsMap[f.key]) {
        setOptionsMap((m) => ({ ...m, [f.key]: f.options! }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => String(r.name ?? "").toLowerCase().includes(s));
  }, [rows, search]);

  function startNew() {
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      init[f.key] = f.type === "boolean" ? true : "";
    });
    setForm(init);
    setEditing({ __new: true });
  }

  function startEdit(row: any) {
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      init[f.key] = row[f.key] ?? (f.type === "boolean" ? false : "");
    });
    setForm(init);
    setEditing(row);
  }

  function validate(): string | null {
    for (const f of fields) {
      if (f.required) {
        const v = form[f.key];
        if (v === "" || v === null || v === undefined) return `${f.label} الزامی است`;
      }
    }
    if (table === "livestock_locations") {
      const dc = form.desirable_capacity;
      const mc = form.max_capacity;
      if (dc !== "" && mc !== "" && dc != null && mc != null && Number(mc) < Number(dc)) {
        return "ظرفیت حداکثر باید بزرگ‌تر یا مساوی ظرفیت مطلوب باشد";
      }
    }
    return null;
  }

  async function save() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const payload: Record<string, any> = {};
    for (const f of fields) {
      let v = form[f.key];
      if (v === "" || v === undefined) v = null;
      if ((f.type === "number" || (f.type === "select" && typeof f.options?.[0]?.value === "number")) && v != null) {
        v = Number(v);
      }
      payload[f.key] = v;
    }
    let result;
    if (editing?.__new) {
      payload.is_deleted = false;
      result = await (supabase as any).from(table).insert(payload);
    } else {
      result = await (supabase as any).from(table).update(payload).eq("id", editing.id);
    }
    setSaving(false);
    if (result.error) {
      const msg = String(result.error.message || "");
      if (msg.includes("uq_") && msg.includes("name")) {
        toast.error("نام تکراری است", { description: "نام واردشده قبلاً ثبت شده است" });
      } else if (msg.includes("max_capacity")) {
        toast.error("ظرفیت حداکثر باید بزرگ‌تر یا مساوی ظرفیت مطلوب باشد");
      } else {
        toast.error("خطا در ذخیره", { description: msg });
      }
      return;
    }
    toast.success(editing?.__new ? "با موفقیت اضافه شد" : "تغییرات ذخیره شد");
    setEditing(null);
    load();
  }

  async function performConfirm() {
    if (!confirm) return;
    const { row, mode } = confirm;
    const update =
      mode === "delete"
        ? { is_deleted: true, deleted_date: new Date().toISOString() }
        : { is_deleted: false, deleted_date: null };
    const { error } = await (supabase as any).from(table).update(update).eq("id", row.id);
    setConfirm(null);
    if (error) {
      toast.error("خطا", { description: error.message });
      return;
    }
    toast.success(mode === "delete" ? "حذف شد" : "بازگردانی شد");
    load();
  }

  function renderCell(r: any, key: string) {
    const f = fields.find((x) => x.key === key);
    if (f?.format) return f.format(r);
    const v = r[key];
    if (typeof v === "boolean") return v ? "✓" : "—";
    if (f?.type === "select") {
      const opts = optionsMap[key] ?? [];
      const found = opts.find((o) => String(o.value) === String(v));
      return found?.label ?? (v ?? "—");
    }
    return v ?? "—";
  }

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-heading text-foreground">{title}</h1>
        <Button onClick={startNew} className="gap-1">
          <Plus className="w-4 h-4" />
          افزودن
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="جستجوی نام..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">فعال</SelectItem>
            <SelectItem value="deleted">حذف شده</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">مرتب‌سازی: نام</SelectItem>
            <SelectItem value="created_at">مرتب‌سازی: تاریخ ایجاد</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">رکوردی یافت نشد</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="text-right p-2">#</th>
                {cols.map((c) => {
                  const f = fields.find((x) => x.key === c);
                  return (
                    <th key={c} className="text-right p-2">
                      {f?.label ?? c}
                    </th>
                  );
                })}
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 text-muted-foreground">{r.id}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2">
                      {renderCell(r, c)}
                    </td>
                  ))}
                  <td className="p-2 text-left">
                    <div className="flex gap-1 justify-end">
                      {filter === "active" ? (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => startEdit(r)} aria-label="ویرایش">
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setConfirm({ row: r, mode: "delete" })}
                            aria-label="حذف"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setConfirm({ row: r, mode: "restore" })}
                          aria-label="بازگردانی"
                        >
                          <RotateCcw className="w-4 h-4 text-primary" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit/New dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.__new ? "افزودن جدید" : "ویرایش رکورد"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label>
                  {f.label}
                  {f.required && <span className="text-destructive mr-1">*</span>}
                </Label>
                {f.type === "boolean" ? (
                  <Select
                    value={String(form[f.key] ?? false)}
                    onValueChange={(v) => setForm({ ...form, [f.key]: v === "true" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">بله</SelectItem>
                      <SelectItem value="false">خیر</SelectItem>
                    </SelectContent>
                  </Select>
                ) : f.type === "select" ? (
                  <Select
                    value={form[f.key] != null && form[f.key] !== "" ? String(form[f.key]) : undefined}
                    onValueChange={(v) => setForm({ ...form, [f.key]: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="انتخاب کنید" />
                    </SelectTrigger>
                    <SelectContent>
                      {(optionsMap[f.key] ?? []).map((o) => (
                        <SelectItem key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={f.type === "number" ? "number" : "text"}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              انصراف
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "ذخیره"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete/Restore confirmation */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.mode === "delete" ? "حذف رکورد" : "بازگردانی رکورد"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.mode === "delete"
                ? `آیا از حذف "${confirm?.row?.name ?? ""}" اطمینان دارید؟ این رکورد به صورت نرم حذف می‌شود و قابل بازگردانی است.`
                : `آیا می‌خواهید "${confirm?.row?.name ?? ""}" را بازگردانی کنید؟`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={performConfirm}>
              {confirm?.mode === "delete" ? "حذف" : "بازگردانی"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
