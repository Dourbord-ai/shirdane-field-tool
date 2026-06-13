import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Pencil, X } from "lucide-react";

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "boolean";
  required?: boolean;
};

interface Props {
  title: string;
  table: string;
  fields: FieldDef[];
  /** Columns to display in the list (defaults to all field keys + id). */
  listColumns?: string[];
  /** Optional extra select string (e.g. embedded relations). */
  selectExtra?: string;
  orderBy?: string;
}

export default function SimpleCrudTable({
  title,
  table,
  fields,
  listColumns,
  selectExtra,
  orderBy = "id",
}: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const cols = listColumns ?? fields.map((f) => f.key);

  async function load() {
    setLoading(true);
    const sel = ["id", ...fields.map((f) => f.key), selectExtra].filter(Boolean).join(", ");
    const { data, error } = await (supabase as any)
      .from(table)
      .select(sel)
      .order(orderBy, { ascending: true })
      .limit(1000);
    if (!error) setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  function startNew() {
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      init[f.key] = f.type === "boolean" ? true : "";
    });
    setForm(init);
    setEditing({});
  }

  function startEdit(row: any) {
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      init[f.key] = row[f.key] ?? (f.type === "boolean" ? false : "");
    });
    setForm(init);
    setEditing(row);
  }

  async function save() {
    setSaving(true);
    const payload: Record<string, any> = {};
    for (const f of fields) {
      let v = form[f.key];
      if (v === "" || v === undefined) v = null;
      if (f.type === "number" && v != null) v = Number(v);
      payload[f.key] = v;
    }
    if (editing?.id) {
      await (supabase as any).from(table).update(payload).eq("id", editing.id);
    } else {
      await (supabase as any).from(table).insert(payload);
    }
    setSaving(false);
    setEditing(null);
    load();
  }

  async function remove(id: number) {
    if (!confirm("حذف این رکورد؟")) return;
    await (supabase as any).from(table).delete().eq("id", id);
    load();
  }

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between">
        <h1 className="text-heading text-foreground">{title}</h1>
        <Button onClick={startNew} className="gap-1">
          <Plus className="w-4 h-4" />
          افزودن
        </Button>
      </div>

      {editing && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-bold">{editing?.id ? "ویرایش" : "افزودن جدید"}</h2>
            <Button size="icon" variant="ghost" onClick={() => setEditing(null)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label>{f.label}</Label>
                {f.type === "boolean" ? (
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={String(form[f.key] ?? false)}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "true" })}
                  >
                    <option value="true">بله</option>
                    <option value="false">خیر</option>
                  </select>
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
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "ذخیره"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)}>
              انصراف
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">رکوردی ثبت نشده است</p>
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
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-2 text-muted-foreground">{r.id}</td>
                  {cols.map((c) => (
                    <td key={c} className="p-2">
                      {typeof r[c] === "boolean" ? (r[c] ? "✓" : "—") : r[c] ?? "—"}
                    </td>
                  ))}
                  <td className="p-2 text-left">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => startEdit(r)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
