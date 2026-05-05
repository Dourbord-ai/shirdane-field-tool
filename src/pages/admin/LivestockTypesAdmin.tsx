import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function LivestockTypesAdmin() {
  return (
    <SimpleCrudTable
      title="انواع دام"
      table="livestock_types"
      fields={[
        { key: "name", label: "نام", required: true },
        { key: "group_id", label: "شناسه گروه", type: "number" },
        { key: "category_id", label: "دسته‌بندی", type: "number" },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
