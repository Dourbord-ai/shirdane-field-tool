import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function FertilityValidationAlert({ messages }: { messages: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <Alert variant="destructive" dir="rtl" className="text-right">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>ثبت عملیات مجاز نیست</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pr-5 space-y-1 mt-1">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
