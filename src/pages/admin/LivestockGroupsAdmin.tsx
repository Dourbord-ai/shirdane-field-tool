import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function LivestockGroupsAdmin() {
  return (
    <SimpleCrudTable
      title="گروه‌های دام"
      table="livestock_groups"
      fields={[
        { key: "name", label: "نام", required: true },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
