import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function SyncTypesAdmin() {
  return (
    <SimpleCrudTable
      title="انواع همزمان‌سازی"
      table="sync_types"
      fields={[
        { key: "name", label: "نام", required: true },
        { key: "medicine_and_times", label: "داروها و زمان‌ها" },
        { key: "inoculation_time", label: "زمان تلقیح", type: "number" },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
