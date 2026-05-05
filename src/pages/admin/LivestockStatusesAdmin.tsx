import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function LivestockStatusesAdmin() {
  return (
    <SimpleCrudTable
      title="وضعیت‌های دام"
      table="livestock_statuses"
      fields={[
        { key: "name", label: "نام", required: true },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
