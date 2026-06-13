import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Trash2, FileText, Image as ImageIcon } from "lucide-react";
import { toPersianDigits } from "@/lib/jalali";
import { safeUUID } from "@/lib/uuid";

export interface PendingAttachment {
  id: string;
  file: File;
}

interface Props {
  files: PendingAttachment[];
  onChange: (files: PendingAttachment[]) => void;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${toPersianDigits(bytes)} B`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} KB`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} MB`;
};

const FileAttachments = ({ files, onChange }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const newOnes: PendingAttachment[] = Array.from(list).map((f) => ({
      id: safeUUID(),
      file: f,
    }));
    onChange([...files, ...newOnes]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (id: string) => {
    onChange(files.filter((f) => f.id !== id));
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-body font-bold text-foreground flex items-center gap-2">
          <Paperclip className="w-4 h-4" />
          پیوست فایل فاکتور
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="rounded-xl gap-2"
        >
          <Paperclip className="w-4 h-4" />
          اضافه کردن فایل
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        تصویر یا PDF فاکتور اصلی را پیوست کنید. حداکثر اندازه هر فایل ۲۰ مگابایت.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handleAdd}
        className="hidden"
      />
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((att) => {
            const isImg = att.file.type.startsWith("image/");
            return (
              <li
                key={att.id}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
              >
                {isImg ? (
                  <ImageIcon className="w-5 h-5 text-primary shrink-0" />
                ) : (
                  <FileText className="w-5 h-5 text-primary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{att.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(att.file.size)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(att.id)}
                  className="text-destructive hover:text-destructive shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default FileAttachments;
