"use client";

import { useRef, useState } from "react";
import { Check, FileText, Loader2, UploadCloud, X } from "lucide-react";
import clsx from "clsx";
import { useApp } from "./app-provider";
import { IconButton } from "./ui";
import { MAX_FILES } from "@/lib/constants";
import { prepareUpload } from "@/lib/files";
import { errorMessage, formatBytes } from "@/lib/utils";

export function FileDropzone({
  files,
  onChange,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const app = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const addFiles = async (incoming: FileList | File[] | null) => {
    if (!incoming || disabled || busy) return;
    const candidates = Array.from(incoming);
    if (files.length + candidates.length > MAX_FILES) {
      app.notify("Mỗi phiên bản nhãn chỉ có tối đa 20 file.", "error");
      return;
    }
    setBusy(true);
    const valid: File[] = [];
    for (const file of candidates) {
      if (
        [...files, ...valid].some(
          (f) =>
            f.name === file.name &&
            f.size === file.size &&
            f.lastModified === file.lastModified,
        )
      )
        continue;
      try {
        await prepareUpload(file, app.mode === "demo");
        valid.push(file);
      } catch (e) {
        app.notify(`${file.name}: ${errorMessage(e)}`, "error");
      }
    }
    onChange([...files, ...valid]);
    setBusy(false);
    if (input.current) input.current.value = "";
  };
  return (
    <div>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
        className="sr-only"
        aria-label="Chọn file nhãn"
        onChange={(e) => void addFiles(e.target.files)}
        disabled={disabled || busy}
      />
      <div
        className={clsx("dropzone", drag && "dragging")}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Tải file nhãn"
        aria-disabled={disabled || busy}
        onClick={() => !disabled && !busy && input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <span>
          {busy ? (
            <Loader2 size={23} className="spin" />
          ) : (
            <UploadCloud size={23} strokeWidth={1.5} />
          )}
        </span>
        <strong>
          {busy ? (
            "Đang kiểm tra loại file và số trang…"
          ) : (
            <>
              Kéo thả nhãn vào đây hoặc <u>chọn file</u>
            </>
          )}
        </strong>
        <p>PDF, PNG, JPG/JPEG, TIFF · tối đa 50 MB/file</p>
        <small>
          Tối đa 20 file/phiên bản · 10 trang/PDF · Nên tải đủ mặt trước và mặt
          sau.
        </small>
      </div>
      {files.length > 0 && (
        <div className="upload-list">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="upload-item">
              <FileText size={20} strokeWidth={1.5} />
              <div>
                <strong>{f.name}</strong>
                <span>
                  {formatBytes(f.size)} · Đã kiểm tra định dạng & số trang
                </span>
              </div>
              <Check size={15} color="#8fa570" />
              <IconButton
                label={`Xóa ${f.name}`}
                onClick={() => onChange(files.filter((_, n) => n !== i))}
                disabled={disabled}
              >
                <X size={15} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
