import { supabase } from "@/integrations/supabase/client";
import SoftDeleteCrudTable from "@/components/admin/SoftDeleteCrudTable";

async function loadGroups() {
  const { data } = await (supabase as any)
    .from("livestock_groups")
    .select("id, name")
    .eq("is_deleted", false)
    .order("name", { ascending: true })
    .limit(1000);
  return (data ?? []).map((r: any) => ({ value: r.id, label: r.name }));
}

export default function LivestockTypesAdmin() {
  return (
    <SoftDeleteCrudTable
      title="انواع دام"
      table="livestock_types"
      fields={[
        { key: "name", label: "نام نوع دام", required: true },
        { key: "group_id", label: "گروه دام", type: "select", loadOptions: loadGroups },
        { key: "category_id", label: "دسته‌بندی", type: "number" },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
