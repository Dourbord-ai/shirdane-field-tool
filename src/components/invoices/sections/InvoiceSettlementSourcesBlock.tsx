// ---------------------------------------------------------------------------
// Tasks 2+3 — Collapsible "منابع تسویه" block. Lists every source as an
// independent card. Order: seller → freight-* → weighing-* → unloading-* →
// misc-*. Configuration is per-card (no group-level controls).
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";

import SettlementSourceCard from "./SettlementSourceCard";
import {
  type SettlementSource,
  type ValidationError,
} from "@/lib/finance/invoiceSettlementBuilder";

interface Props {
  sources: SettlementSource[];
  errors: ValidationError[];
  onPatchSource: (sourceId: string, patch: Partial<SettlementSource>) => void;
}

const KIND_ORDER: Record<SettlementSource["kind"], number> = {
  seller: 0, freight: 1, weighing: 2, unloading: 3, misc: 4,
};

export default function InvoiceSettlementSourcesBlock({ sources, errors, onPatchSource }: Props) {
  const [open, setOpen] = useState(true);

  const sorted = [...sources].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const enabledCount = sources.filter((s) => s.settlement_requirement === "requires_settlement").length;

  return (
    <Card className="p-4 space-y-3 bg-card border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">منابع تسویه</h2>
          <span className="text-xs text-muted-foreground">
            ({enabledCount} از {sources.length} منبع نیازمند تسویه)
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="space-y-3">
          {sorted.map((s) => (
            <SettlementSourceCard
              key={s.source_id}
              source={s}
              errors={errors.filter((e) => e.source_id === s.source_id)}
              onPatch={(patch) => onPatchSource(s.source_id, patch)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
