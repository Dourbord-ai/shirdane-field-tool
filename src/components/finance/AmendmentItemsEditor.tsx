// =============================================================================
// components/finance/AmendmentItemsEditor.tsx
// -----------------------------------------------------------------------------
// جدول آیتم‌های اصلاحیه با قابلیت ویرایش inline تعداد و قیمت واحد.
// =============================================================================

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AmendmentItemRow,
  calcAmendmentTotal,
} from "@/lib/finance/amendment";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  items: AmendmentItemRow[];
  readOnly?: boolean;
  onItemChange?: (updated: AmendmentItemRow) => void;
}

interface EditState {
  quantity: string;
  unit_price: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ActionBadge({ action }: { action: AmendmentItemRow["action"] }) {
  const map: Record<AmendmentItemRow["action"], { label: string; cls: string }> = {
    add:    { label: "اضافه",    cls: "bg-green-100 text-green-700" },
    update: { label: "ویرایش",  cls: "bg-blue-100 text-blue-700" },
    delete: { label: "حذف",     cls: "bg-red-100 text-red-700" },
    keep:   { label: "بدون تغییر", cls: "bg-gray-100 text-gray-500" },
  };
  const { label, cls } = map[action];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold",
        cls
      )}
    >
      {label}
    </span>
  );
}

function fmt(n: number) {
  return n.toLocaleString("fa-IR");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AmendmentItemsEditor({ items, readOnly = false, onItemChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ quantity: "", unit_price: "" });

  const grandTotal = calcAmendmentTotal(items);

  function startEdit(item: AmendmentItemRow) {
    setEditingId(item.id);
    setEditState({
      quantity: String(item.quantity),
      unit_price: String(item.unit_price),
    });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit(item: AmendmentItemRow) {
    const qty = parseFloat(editState.quantity) || 0;
    const price = parseFloat(editState.unit_price) || 0;
    const updated: AmendmentItemRow = {
      ...item,
      quantity: qty,
      unit_price: price,
      total_amount: qty * price,
    };
    onItemChange?.(updated);
    setEditingId(null);
  }

  const liveTotal =
    editingId !== null
      ? (parseFloat(editState.quantity) || 0) * (parseFloat(editState.unit_price) || 0)
      : null;

  if (!items || items.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8 text-sm">
        هیچ آیتمی برای این اصلاحیه وجود ندارد
      </div>
    );
  }

  return (
    <div dir="rtl" className="w-full overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm text-right">
        {/* ---------------------------------------------------------------- */}
        <thead className="bg-muted text-muted-foreground">
          <tr className="divide-x divide-x-reverse divide-border">
            <th className="px-3 py-2 font-medium w-8">#</th>
            <th className="px-3 py-2 font-medium">وضعیت</th>
            <th className="px-3 py-2 font-medium">نوع</th>
            <th className="px-3 py-2 font-medium">شرح</th>
            <th className="px-3 py-2 font-medium text-center">تعداد</th>
            <th className="px-3 py-2 font-medium text-center">قیمت واحد</th>
            <th className="px-3 py-2 font-medium text-center">جمع کل</th>
            {!readOnly && <th className="px-3 py-2 font-medium text-center w-20">عملیات</th>}
          </tr>
        </thead>

        {/* ---------------------------------------------------------------- */}
        <tbody className="divide-y divide-border bg-card">
          {items.map((item, idx) => {
            const isEditing = editingId === item.id;
            const isDeleted = item.action === "delete";

            return (
              <tr
                key={item.id}
                className={cn(
                  "divide-x divide-x-reverse divide-border transition-colors",
                  isDeleted && "opacity-50",
                  isEditing && "bg-blue-50/50"
                )}
              >
                {/* # */}
                <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>

                {/* وضعیت */}
                <td className="px-3 py-2">
                  <ActionBadge action={item.action} />
                </td>

                {/* نوع */}
                <td className="px-3 py-2 text-muted-foreground text-xs">
                  {item.product_type}
                </td>

                {/* شرح */}
                <td className="px-3 py-2 max-w-[180px] truncate">
                  {item.description ?? "—"}
                </td>

                {/* تعداد */}
                <td className="px-3 py-2 text-center">
                  {isEditing ? (
                    <Input
                      type="number"
                      className="h-7 w-20 text-center mx-auto"
                      value={editState.quantity}
                      onChange={(e) =>
                        setEditState((s) => ({ ...s, quantity: e.target.value }))
                      }
                    />
                  ) : (
                    <span>
                      {item.action === "update" && item.original_quantity !== null && (
                        <span className="block text-xs text-muted-foreground line-through">
                          {fmt(item.original_quantity)}
                        </span>
                      )}
                      {fmt(item.quantity)}
                    </span>
                  )}
                </td>

                {/* قیمت واحد */}
                <td className="px-3 py-2 text-center">
                  {isEditing ? (
                    <Input
                      type="number"
                      className="h-7 w-28 text-center mx-auto"
                      value={editState.unit_price}
                      onChange={(e) =>
                        setEditState((s) => ({ ...s, unit_price: e.target.value }))
                      }
                    />
                  ) : (
                    <span>
                      {item.action === "update" && item.original_unit_price !== null && (
                        <span className="block text-xs text-muted-foreground line-through">
                          {fmt(item.original_unit_price)}
                        </span>
                      )}
                      {fmt(item.unit_price)}
                    </span>
                  )}
                </td>

                {/* جمع کل */}
                <td className="px-3 py-2 text-center font-medium">
                  {isEditing && liveTotal !== null ? (
                    <span className="text-blue-600 font-semibold">{fmt(liveTotal)}</span>
                  ) : (
                    <span>
                      {item.action === "update" && item.original_total_amount !== null && (
                        <span className="block text-xs text-muted-foreground line-through">
                          {fmt(item.original_total_amount)}
                        </span>
                      )}
                      {fmt(item.total_amount)}
                    </span>
                  )}
                </td>

                {/* عملیات */}
                {!readOnly && (
                  <td className="px-3 py-2 text-center">
                    {isEditing ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                          onClick={() => saveEdit(item)}
                        >
                          <Save className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={cancelEdit}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      !isDeleted && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => startEdit(item)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>

        {/* ---------------------------------------------------------------- */}
        <tfoot className="bg-muted border-t border-border">
          <tr>
            <td
              colSpan={readOnly ? 6 : 7}
              className="px-3 py-2 text-left text-muted-foreground text-xs"
            >
              جمع کل (بدون آیتم‌های حذف‌شده)
            </td>
            <td className="px-3 py-2 text-center font-bold text-foreground">
              {fmt(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default AmendmentItemsEditor;

