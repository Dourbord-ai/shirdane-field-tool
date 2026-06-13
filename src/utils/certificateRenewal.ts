// ============================================================
// certificateRenewal.ts — Auto-renewal stub for Shirdane.
//
// In the source project (dorbourdban) this opens an
// administrative ticket in a `tickets` table. Shirdane does not
// (yet) have a compatible ticket/notification system, so the
// renewal trigger is reduced to a console log here. The schema
// columns remain in place so a future ticket integration can
// drop in without migration.
// ============================================================

import jalaali from '@/lib/jalaali';
import {
  CertificateRow,
  RENEWAL_LEAD_TIME_OPTIONS,
} from '@/hooks/useCertificates';

const shamsiToDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const parts = s.split('/').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  try {
    const g = jalaali.toGregorian(parts[0], parts[1], parts[2]);
    return new Date(g.gy, g.gm - 1, g.gd);
  } catch {
    return null;
  }
};

function isDue(cert: CertificateRow): boolean {
  if (!cert.renewal_lead_time) return false;
  if (cert.renewal_ticket_id) return false;
  const expiry = shamsiToDate(cert.expiry_date_shamsi);
  if (!expiry) return false;
  const opt = RENEWAL_LEAD_TIME_OPTIONS.find((o) => o.value === cert.renewal_lead_time);
  if (!opt) return false;

  let trigger: Date;
  if (cert.renewal_lead_time === 'custom') {
    const customTrigger = shamsiToDate(cert.renewal_custom_date_shamsi);
    if (!customTrigger) return false;
    trigger = customTrigger;
  } else {
    trigger = new Date(expiry);
    trigger.setDate(trigger.getDate() - opt.days);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  trigger.setHours(0, 0, 0, 0);
  return today >= trigger;
}

export async function processRenewalTickets(
  certs: CertificateRow[]
): Promise<number> {
  let due = 0;
  for (const c of certs) {
    if (c.id <= 0) continue;
    if (isDue(c)) {
      due += 1;
      console.info(
        `[certificates] Renewal due for «${c.title}» (id ${c.id}). ` +
          `Ticket integration not configured in this project — skipping.`
      );
    }
  }
  return due;
}
