import SoftDeleteCrudTable from "@/components/admin/SoftDeleteCrudTable";

export default function LivestockLocationsAdmin() {
  return (
    <SoftDeleteCrudTable
      title="بهاربند / جایگاه دام"
      table="livestock_locations"
      fields={[
        { key: "name", label: "نام بهاربند / جایگاه", required: true },
        { key: "code", label: "کد", type: "number" },
        { key: "desirable_capacity", label: "ظرفیت مطلوب", type: "number" },
        { key: "max_capacity", label: "ظرفیت حداکثر", type: "number" },
        { key: "width", label: "عرض", type: "number" },
        { key: "length", label: "طول", type: "number" },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
