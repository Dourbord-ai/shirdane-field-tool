import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function SyncTypeDetailsAdmin() {
  return (
    <SimpleCrudTable
      title="جزئیات همزمان‌سازی"
      table="sync_type_details"
      fields={[
        { key: "sync_type_id", label: "شناسه نوع همزمان‌سازی", type: "number" },
        { key: "medicine_id", label: "شناسه دارو", type: "number" },
        { key: "sufficient_amount", label: "مقدار کافی", type: "number" },
        { key: "taking_medication_time", label: "زمان مصرف", type: "number" },
        { key: "taking_medication_type_id", label: "نوع مصرف", type: "number" },
        { key: "is_medical", label: "دارویی", type: "boolean" },
        { key: "description", label: "توضیحات" },
      ]}
    />
  );
}
