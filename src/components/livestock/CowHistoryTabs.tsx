import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CowHistoryTab from "./CowHistoryTab";

export default function CowHistoryTabs({ cowId }: { cowId: number }) {
  const [tab, setTab] = useState("type");
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-body-lg font-bold text-foreground">تاریخچه دام</h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="type">نوع</TabsTrigger>
          <TabsTrigger value="status">وضعیت</TabsTrigger>
          <TabsTrigger value="location">مکان</TabsTrigger>
          <TabsTrigger value="sync">همزمان‌سازی</TabsTrigger>
        </TabsList>
        <TabsContent value="type">
          <CowHistoryTab cowId={cowId} table="cow_types" refColumn="type_id" refTable="livestock_types" />
        </TabsContent>
        <TabsContent value="status">
          <CowHistoryTab cowId={cowId} table="cow_statuses" refColumn="status_id" refTable="livestock_statuses" />
        </TabsContent>
        <TabsContent value="location">
          <CowHistoryTab cowId={cowId} table="cow_locations" refColumn="location_id" refTable="livestock_locations" />
        </TabsContent>
        <TabsContent value="sync">
          <CowHistoryTab cowId={cowId} table="cow_syncs" refColumn="sync_type_id" refTable="sync_types" />
        </TabsContent>
      </Tabs>
    </section>
  );
}
