import React, { useState } from "react";

interface Amendment {
  id: string;
  status: "pending" | "reviewed" | "approved" | "rejected";
  reason: string;
  created_at: string;
}

interface Props {
  factorId: string;
  amendment?: Amendment | null;
  onRequestAmendment?: () => void;
}

const STATUS_LABEL: Record<Amendment["status"], string> = {
  pending:  "در انتظار بررسی",
  reviewed: "در حال بررسی",
  approved: "تأیید شده",
  rejected: "رد شده",
};

const STATUS_COLOR: Record<Amendment["status"], string> = {
  pending:  "bg-yellow-100 text-yellow-800",
  reviewed: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export const AmendmentPanel: React.FC<Props> = ({
  factorId,
  amendment,
  onRequestAmendment,
}) => {
  const [loading] = useState(false);

  if (loading) {
    return <div className="text-sm text-gray-400 py-2">در حال بارگذاری...</div>;
  }

  if (!amendment) {
    return (
      <div className="mt-4 border border-dashed border-gray-300 rounded-lg p-4 text-center">
        <p className="text-sm text-gray-500 mb-2">اصلاحیه‌ای ثبت نشده</p>
        <button
          onClick={onRequestAmendment}
          className="text-sm bg-indigo-600 text-white px-4 py-1.5 rounded hover:bg-indigo-700"
        >
          + درخواست اصلاح
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">اصلاحیه فاکتور</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[amendment.status]}`}>
          {STATUS_LABEL[amendment.status]}
        </span>
      </div>
      <p className="text-sm text-gray-600">{amendment.reason}</p>
      <p className="text-xs text-gray-400 mt-1">
        ثبت شده: {new Date(amendment.created_at).toLocaleDateString("fa-IR")}
      </p>
      {/* TODO: دکمه‌های Review/Approve/Reject برای مدیر - فاز بعدی */}
    </div>
  );
};

export default AmendmentPanel;

