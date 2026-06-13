import { supabase } from "@/integrations/supabase/client";
import SoftDeleteCrudTable from "@/components/admin/SoftDeleteCrudTable";

export default function LivestockGroupsAdmin() {
  return (
    <SoftDeleteCrudTable
      title="گروه‌های دام"
      table="livestock_groups"
      fields={[
        { key: "name", label: "نام گروه", required: true },
        { key: "is_active", label: "فعال", type: "boolean" },
      ]}
    />
  );
}
