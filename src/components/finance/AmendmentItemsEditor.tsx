import React from "react";

// Types
interface AmendmentItem {
  id: string;
  factor_item_id: string;
  change_type: "added" | "removed" | "modified";
  amended_quantity?: number;
  amended_unit_price?: number;
  amended_total_amount?: number;
  amended_description?: string;
}

interface Props {
  amendmentId: string;
  items: AmendmentItem[];
  onItemChange?: (item: AmendmentItem) => void;
}

// Component
export default function AmendmentItemsEditor({
  amendmentId,
  items,
  onItemChange,
}: Props) {
  if (!items || items.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8">
        هیچ آیتمی برای این اصلاحیه وجود ندارد
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-600">
        آیتم‌های اصلاحیه ({items.length})
      </h3>

      {items.map((item) => (
        <div
          key={item.id}
          className="border rounded-lg p-3 flex justify-between items-center gap-4"
        >
          <span className="text-xs text-gray-500 w-24">{item.change_type}</span>
          <span className="flex-1 text-sm">{item.amended_description ?? "—"}</span>
          <span className="text-sm font-mono">
            {item.amended_total_amount?.toLocaleString("fa-IR") ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

