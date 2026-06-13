import SoftDeleteCrudTable from "@/components/admin/SoftDeleteCrudTable";

export default function LivestockStatusesAdmin() {
  return (
    <SoftDeleteCrudTable
      title="وضعیت‌های دام"
      table="livestock_statuses"
      fields={[
        { key: "name", label: "نام وضعیت دام", required: true },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
