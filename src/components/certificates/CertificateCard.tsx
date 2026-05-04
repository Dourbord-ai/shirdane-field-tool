// ============================================================
// CertificateCard.tsx — One tile in the certificates gallery.
// ============================================================

import { CertificateRow, getCertificateStatus } from '@/hooks/useCertificates';
import StatusBadge from './StatusBadge';
import sampleCertificate from '@/assets/sample-certificate.jpg';

interface Props {
  certificate: CertificateRow;
  onClick: () => void;
}

const CertificateCard = ({ certificate, onClick }: Props) => {
  const { status, daysRemaining } = getCertificateStatus(certificate.expiry_date_shamsi);

  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative h-40 w-full overflow-hidden bg-muted">
        <img
          src={certificate.image_url || sampleCertificate}
          alt={certificate.title}
          className="h-full w-full object-cover transition group-hover:scale-105"
          loading="lazy"
        />
        <span className="absolute right-2 top-2 rounded-md bg-background/85 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur">
          {certificate.doc_type}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-1 text-sm font-bold text-foreground">{certificate.title}</h3>
        {certificate.issuer && (
          <p className="line-clamp-1 text-xs text-muted-foreground">{certificate.issuer}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <StatusBadge status={status} daysRemaining={daysRemaining} />
          {certificate.expiry_date_shamsi && (
            <span className="text-[10px] text-muted-foreground">{certificate.expiry_date_shamsi}</span>
          )}
        </div>
      </div>
    </button>
  );
};

export default CertificateCard;
