import * as React from "react";
import { UploadCloud, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dropzone({
  onFilesSelected,
  acceptedTypes = ".pdf,.docx,.doc,.png,.jpg,.jpeg",
  maxSizeMB = 10,
  maxFiles = 5,
  files = [],
  onRemoveFile,
  disabled = false,
  className,
}) {
  const [isDragOver, setIsDragOver] = React.useState(false);
  const inputRef = React.useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected?.(Array.from(e.dataTransfer.files));
    }
  };

  const handleChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected?.(Array.from(e.target.files));
    }
  };

  return (
    <div className={cn("space-y-3 font-sans", className)}>
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center p-6 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer text-center",
          isDragOver
            ? "border-accent bg-blue-50/50"
            : "border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-400",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles > 1}
          accept={acceptedTypes}
          onChange={handleChange}
          disabled={disabled}
          className="hidden"
        />
        <div className="h-12 w-12 rounded-full bg-blue-50 text-accent flex items-center justify-center mb-3">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-dark-slate mb-1">
          Click to upload or drag & drop
        </p>
        <p className="text-xs text-muted-slate uppercase tracking-wider">
          PDF, DOCX, PNG, OR JPG — MAX {maxSizeMB} MB
        </p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, idx) => (
            <li
              key={`${file.name || 'file'}-${idx}`}
              className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-surface shadow-sm text-sm"
            >
              <div className="flex items-center gap-2.5 truncate">
                <FileText className="h-4 w-4 text-accent shrink-0" />
                <span className="truncate font-medium text-dark-slate text-xs">
                  {file.name}
                </span>
                {file.size && (
                  <span className="text-[11px] text-muted-slate shrink-0">
                    ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                )}
              </div>
              {onRemoveFile && (
                <button
                  type="button"
                  onClick={() => onRemoveFile(idx)}
                  className="p-1 rounded-md text-muted-slate hover:text-destructive hover:bg-red-50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
