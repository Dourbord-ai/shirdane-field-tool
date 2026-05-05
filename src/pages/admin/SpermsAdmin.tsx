import SimpleCrudTable from "@/components/admin/SimpleCrudTable";
export default function SpermsAdmin() {
  return (
    <SimpleCrudTable
      title="اسپرم‌ها"
      table="sperms"
      fields={[
        { key: "name", label: "نام" },
        { key: "code", label: "کد" },
        { key: "company_id", label: "شناسه شرکت", type: "number" },
        { key: "tpi", label: "TPI", type: "number" },
        { key: "pl", label: "PL", type: "number" },
        { key: "milk", label: "Milk", type: "number" },
        { key: "threshold", label: "حد آستانه", type: "number" },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
