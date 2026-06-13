// Title strip used inside ported pages (header itself is in AppLayout).
interface Props { title: string; }
export default function DashboardHeader({ title }: Props) {
  return (
    <div className="mb-3 px-1">
      <h1 className="text-xl font-bold text-foreground">{title}</h1>
    </div>
  );
}
