import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function LivestockLocationsAdmin() {
  return (
    <SimpleCrudTable
      title="مکان‌های نگهداری دام"
      table="livestock_locations"
      fields={[
        { key: "name", label: "نام", required: true },
        { key: "code", label: "کد", type: "number" },
        { key: "desirable_capacity", label: "ظرفیت مطلوب", type: "number" },
        { key: "max_capacity", label: "حداکثر ظرفیت", type: "number" },
        { key: "width", label: "عرض", type: "number" },
        { key: "length", label: "طول", type: "number" },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
