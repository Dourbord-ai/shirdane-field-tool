// Pick a photoreal cow image based on sex/status.
// Used in the livestock list, profile, and anywhere a cow is visualized.
import cowMilking from "@/assets/cow-milking.jpg";
import cowDry from "@/assets/cow-dry.jpg";
import cowPregnant from "@/assets/cow-pregnant.jpg";
import cowBull from "@/assets/cow-bull.jpg";
import cowHeifer from "@/assets/cow-heifer.jpg";
import cowExited from "@/assets/cow-exited.jpg";
import { isFemaleCow, isMaleCow } from "@/lib/cowPresence";

export type CowImageInput = {
  sex?: number | null;
  sextype?: string | null;
  existancestatus?: number | null;
  is_dry?: boolean | null;
  last_fertility_status?: number | null;
};

export function cowImageFor(c: CowImageInput | null | undefined): string {
  if (!c) return cowHeifer;
  // Out of herd → barn shot
  if (c.existancestatus != null && c.existancestatus !== 0) return cowExited;
  if (isMaleCow(c)) return cowBull;
  if (isFemaleCow(c)) {
    // Pregnant (test final positive = 8) takes precedence visually
    if (c.last_fertility_status === 8) return cowPregnant;
    if (c.is_dry === true) return cowDry;
    if (c.is_dry === false) return cowMilking;
    return cowHeifer;
  }
  return cowHeifer;
}
