import { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";
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
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className={cn("space-y-2", className)} ref={ref}>
      {label && (
        <label className="block text-sm font-medium text-foreground">{label}</label>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={() => { setOpen(!open); setSearch(""); }}
          className="w-full touch-target rounded-xl border border-input bg-background px-4 py-3 text-right text-body flex items-center justify-between gap-2 transition-all duration-200 hover:shadow-[0_2px_12px_-2px_hsl(142_50%_36%/0.15)] hover:border-primary/20 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg animate-fade-in overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجو..."
                className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground text-center">موردی یافت نشد</p>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "w-full text-right px-4 py-3 text-sm transition-colors hover:bg-primary/5",
                      o.value === value && "bg-primary/10 text-primary font-medium"
                    )}
                  >
                    {o.label}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
