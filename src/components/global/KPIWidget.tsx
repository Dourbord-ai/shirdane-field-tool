import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlobalCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  as?: "div" | "button";
}

export function GlobalCard({ children, className, onClick, as = "div" }: GlobalCardProps) {
  const Tag = as as any;
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "card-dashboard text-right",
        onClick && "cursor-pointer active:scale-[0.99]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

interface KPIWidgetProps {
  label: string;
  value: ReactNode;
  hint?: string;
  image?: string;
  imageAlt?: string;
  accent?: "green" | "blue" | "orange" | "purple";
  className?: string;
  onClick?: () => void;
}

const accentRing: Record<string, string> = {
  green: "hover:shadow-[0_14px_40px_-12px_hsl(127_58%_58%/0.25)]",
  blue: "hover:shadow-[0_14px_40px_-12px_hsl(217_91%_60%/0.25)]",
  orange: "hover:shadow-[0_14px_40px_-12px_hsl(38_92%_55%/0.25)]",
  purple: "hover:shadow-[0_14px_40px_-12px_hsl(258_90%_66%/0.25)]",
};

export function KPIWidget({
  label, value, hint, image, imageAlt = "", accent = "green", className, onClick,
}: KPIWidgetProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("kpi-tile w-full text-right group", accentRing[accent], className)}
    >
      <div className="flex items-start justify-between gap-2 relative z-10">
        <div className="min-w-0 flex-1">
          <p className="kpi-label">{label}</p>
          <p className="kpi-value mt-1 break-words">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
        </div>
        {image && (
          <img
            src={image}
            alt={imageAlt}
            loading="lazy"
            className="w-16 h-16 sm:w-20 sm:h-20 object-contain shrink-0 -my-2 -mr-1 drop-shadow-[0_6px_18px_rgba(0,0,0,0.4)]"
          />
        )}
      </div>
    </button>
  );
}
