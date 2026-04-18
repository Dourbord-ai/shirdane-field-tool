import { useState, useEffect, useRef } from "react";
import { ChevronDown, Search, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Option {
  label: string;
  value: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "انتخاب کنید...",
  label,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const selected = options.find((o) => o.value === value);

  // Lock body scroll when sheet is open and focus search
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      // Focus the search input shortly after the sheet opens
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => {
        document.body.style.overflow = original;
        clearTimeout(t);
      };
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const closeSheet = () => {
    setOpen(false);
    setSearch("");
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label className="block text-sm font-medium text-foreground">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full touch-target rounded-xl border border-input bg-background px-4 py-3 text-right text-body flex items-center justify-between gap-2 transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.15)] hover:border-primary/20 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm animate-fade-in"
            onClick={closeSheet}
          />

          {/* Sheet */}
          <div className="relative w-full sm:max-w-lg sm:rounded-2xl bg-card shadow-2xl flex flex-col h-[92vh] sm:h-[80vh] rounded-t-3xl animate-slide-up overflow-hidden">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-12 h-1.5 rounded-full bg-muted-foreground/30" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h3 className="text-body-lg font-bold text-foreground">
                {label || "انتخاب کنید"}
              </h3>
              <button
                type="button"
                onClick={closeSheet}
                className="p-2 rounded-xl hover:bg-muted transition-colors touch-target"
                aria-label="بستن"
              >
                <X className="w-5 h-5 text-foreground" />
              </button>
            </div>

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-background border-2 border-border focus-within:border-primary transition-colors">
                <Search className="w-5 h-5 text-muted-foreground shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="جستجو..."
                  className="w-full bg-transparent text-body text-foreground placeholder:text-muted-foreground outline-none"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="p-1 rounded-lg hover:bg-muted transition-colors"
                    aria-label="پاک کردن"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {/* Options list */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                    <Search className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <p className="text-body text-muted-foreground text-center">
                    موردی یافت نشد
                  </p>
                </div>
              ) : (
                <ul className="py-2">
                  {filtered.map((o) => {
                    const isSelected = o.value === value;
                    return (
                      <li key={o.value}>
                        <button
                          type="button"
                          onClick={() => {
                            onChange(o.value);
                            closeSheet();
                          }}
                          className={cn(
                            "w-full text-right px-5 py-4 text-body flex items-center justify-between gap-3 transition-colors border-b border-border/50 last:border-b-0",
                            isSelected
                              ? "bg-primary/10 text-primary font-bold"
                              : "text-foreground hover:bg-muted/60 active:bg-muted"
                          )}
                        >
                          <span className="flex-1 truncate">{o.label}</span>
                          {isSelected && (
                            <Check className="w-5 h-5 text-primary shrink-0" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer count */}
            <div className="px-5 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground text-center">
              {filtered.length} مورد
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
