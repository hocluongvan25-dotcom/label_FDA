"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  FileImage,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import { useApp } from "./app-provider";
import { IconButton } from "./ui";
import type {
  BoundingBox,
  Evidence,
  LabelVersion,
  Severity,
} from "@/lib/types";
import { downloadBlob, errorMessage } from "@/lib/utils";
import { normalizePages } from "@/lib/files";

export function LabelViewer({
  label,
  evidence,
  severity = "major",
  compact = false,
  selectionEnabled = false,
  onSelectRegion,
}: {
  label: LabelVersion;
  evidence?: Evidence;
  severity?: Severity;
  compact?: boolean;
  selectionEnabled?: boolean;
  onSelectRegion?: (evidence: Evidence) => void;
}) {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const [dragBox, setDragBox] = useState<BoundingBox | null>(null);
  const dragStart = useRef<[number, number] | null>(null);
  const point = (e: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top) / rect.height),
    ];
  };
  const box = (start: [number, number], end: [number, number]): BoundingBox => [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ];
  const [fileId, setFileId] = useState(label.original_files[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const file =
    label.original_files.find((f) => f.id === fileId) ??
    label.original_files[0];
  const normalized = label.normalized_files.find(
    (f) =>
      f.id === `${file?.id}:page-${page}` ||
      (f.original_file_id === file?.id && f.page === page),
  );
  const originalFiles = label.original_files;
  const snapshotRef = useRef({ file, normalized, label });
  snapshotRef.current = { file, normalized, label };
  useEffect(() => {
    if (
      evidence?.file_id &&
      originalFiles.some((f) => f.id === evidence.file_id)
    ) {
      setFileId(evidence.file_id);
      setPage(evidence.page);
    }
  }, [evidence?.file_id, evidence?.page, label.id, originalFiles]);
  useEffect(() => {
    let active = true;
    let url = "";
    setLoading(true);
    setError("");
    const load = async () => {
      const { file, normalized, label } = snapshotRef.current;
      if (!file) throw new Error("Không có file nhãn.");
      if (
        appRef.current.mode === "supabase" &&
        (normalized ?? file).scan_status !== "clean"
      )
        throw new Error(
          "File gốc phải được quét mã độc thật và có trạng thái sạch trước khi mở file gốc hoặc chạy OCR. Bước quét chỉ chạy trong worker (cần ClamAV); nếu trạng thái đứng lâu, xem nguyên nhân trong panel “Phân tích nhãn theo từng bước”.",
        );
      let blob = await appRef.current.getFileBlob(normalized ?? file);
      if (
        !normalized &&
        ["application/pdf", "image/tiff"].includes(file.mime_type)
      ) {
        const pages = await normalizePages(blob, file);
        if (!pages[page - 1]) throw new Error("Trang nhãn không tồn tại.");
        blob = pages[page - 1].image;
      }
      url = URL.createObjectURL(blob);
      if (active) {
        setSrc(url);
        setLoading(false);
        await appRef.current.logFileAccess(label, normalized ?? file);
      }
    };
    load().catch((e) => {
      if (active) {
        setError(errorMessage(e));
        setLoading(false);
      }
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    file?.id,
    file?.scan_status,
    normalized?.id,
    normalized?.scan_status,
    page,
    label.id,
  ]);
  const selectedBox =
    evidence?.file_id === file?.id && evidence.page === page
      ? evidence.bbox
      : null;
  useEffect(() => {
    if (!selectedBox || !canvasRef.current || !imageRef.current || loading)
      return;
    const timeout = setTimeout(() => {
      const container = canvasRef.current;
      const image = imageRef.current;
      if (!container || !image) return;
      container.scrollTo({
        top: Math.max(
          0,
          image.offsetTop +
            ((selectedBox[1] + selectedBox[3]) / 2) * image.clientHeight -
            container.clientHeight / 2,
        ),
        left: Math.max(
          0,
          image.offsetLeft +
            ((selectedBox[0] + selectedBox[2]) / 2) * image.clientWidth -
            container.clientWidth / 2,
        ),
        behavior: "smooth",
      });
    }, 70);
    return () => clearTimeout(timeout);
  }, [selectedBox, zoom, loading]);
  const download = async () => {
    if (!file) return;
    setDownloading(true);
    try {
      downloadBlob(await app.getFileBlob(file), file.name);
      await app.logFileAccess(label, file, "download");
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      <div className="label-toolbar">
        <div>
          <FileImage size={14} color="#97ae7b" />
          <select
            aria-label="Chọn panel nhãn"
            value={file?.id ?? ""}
            onChange={(e) => {
              setFileId(e.target.value);
              setPage(1);
              setZoom(1);
            }}
          >
            {label.original_files.map((f, i) => (
              <option key={f.id} value={f.id}>
                {f.name.includes("front")
                  ? "Mặt trước"
                  : f.name.includes("back")
                    ? "Mặt sau"
                    : `File ${i + 1}: ${f.name}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <IconButton
            label="Thu nhỏ nhãn"
            disabled={zoom <= 0.6}
            onClick={() =>
              setZoom((z) => Math.max(0.6, Math.round((z - 0.2) * 10) / 10))
            }
          >
            <Minus size={13} />
          </IconButton>
          <span>{Math.round(zoom * 100)}%</span>
          <IconButton
            label="Phóng to nhãn"
            disabled={zoom >= 3}
            onClick={() =>
              setZoom((z) => Math.min(3, Math.round((z + 0.2) * 10) / 10))
            }
          >
            <Plus size={13} />
          </IconButton>
          <IconButton label="Vừa khung" onClick={() => setZoom(1)}>
            <Expand size={13} />
          </IconButton>
        </div>
      </div>
      <div className="label-canvas" ref={canvasRef}>
        {loading ? (
          <div className="viewer-loading">
            <Loader2 size={24} className="spin" />
            <span>Đang mở phiên bản nhãn…</span>
          </div>
        ) : error ? (
          <div className="viewer-loading">
            <FileImage size={25} />
            <span>{error}</span>
          </div>
        ) : (
          <div
            className={`label-image-wrap ${selectionEnabled ? "selecting-region" : ""}`}
            onPointerDown={(e) => {
              if (!selectionEnabled || e.button !== 0) return;
              e.preventDefault();
              dragStart.current = point(e);
              setDragBox(null);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (selectionEnabled && dragStart.current)
                setDragBox(box(dragStart.current, point(e)));
            }}
            onPointerCancel={() => {
              dragStart.current = null;
              setDragBox(null);
            }}
            onPointerUp={(e) => {
              if (!selectionEnabled || !dragStart.current || !file) return;
              const selected = box(dragStart.current, point(e));
              dragStart.current = null;
              setDragBox(null);
              if (
                selected[2] - selected[0] < 0.01 ||
                selected[3] - selected[1] < 0.01
              )
                return;
              const text = label.extracted_fields
                .filter(
                  (f) =>
                    f.evidence.file_id === file.id &&
                    f.evidence.page === page &&
                    f.evidence.bbox &&
                    f.evidence.bbox[0] < selected[2] &&
                    f.evidence.bbox[2] > selected[0] &&
                    f.evidence.bbox[1] < selected[3] &&
                    f.evidence.bbox[3] > selected[1],
                )
                .map((f) => f.evidence.text)
                .join("\n");
              onSelectRegion?.({
                file_id: file.id,
                page,
                bbox: selected,
                text,
                kind: "observed",
              });
            }}
            ref={imageRef}
            style={{ width: `${zoom * 100}%` }}
          >
            <img
              src={src}
              alt={`${file?.name} · trang ${page} · nhãn v${label.version}`}
              onLoad={() => {
                if (selectedBox && canvasRef.current && imageRef.current)
                  canvasRef.current.scrollTop = Math.max(
                    0,
                    imageRef.current.offsetTop +
                      selectedBox[1] * imageRef.current.clientHeight -
                      80,
                  );
              }}
            />
            {dragBox && (
              <div
                className="bbox-highlight region-selection"
                style={{
                  left: `${dragBox[0] * 100}%`,
                  top: `${dragBox[1] * 100}%`,
                  width: `${(dragBox[2] - dragBox[0]) * 100}%`,
                  height: `${(dragBox[3] - dragBox[1]) * 100}%`,
                }}
              />
            )}
            {selectedBox && (
              <div
                className={`bbox-highlight ${severity}`}
                style={{
                  left: `${selectedBox[0] * 100}%`,
                  top: `${selectedBox[1] * 100}%`,
                  width: `${(selectedBox[2] - selectedBox[0]) * 100}%`,
                  height: `${(selectedBox[3] - selectedBox[1]) * 100}%`,
                }}
              >
                <span className="bbox-highlight-label">
                  Evidence · trang {page}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="label-footer">
        <span>
          {selectionEnabled
            ? "Kéo trên nhãn để chọn vùng evidence cho finding thủ công"
            : selectedBox
              ? "Vùng evidence được đánh dấu trên nhãn gốc"
              : evidence?.kind === "absence"
                ? "Chưa phát hiện thông tin · đối chiếu toàn bộ panel"
                : evidence?.kind === "dossier"
                  ? "Evidence từ hồ sơ, không phải vùng trên nhãn"
                  : `Nhãn v${label.version} · file gốc không bị ghi đè`}
        </span>
        {file && file.page_count > 1 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <IconButton
              label="Trang trước"
              onClick={() => setPage((p) => p - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft size={12} />
            </IconButton>
            <span>
              {page}/{file.page_count}
            </span>
            <IconButton
              label="Trang sau"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= file.page_count}
            >
              <ChevronRight size={12} />
            </IconButton>
          </div>
        ) : (
          !compact && (
            <button
              className="text-button"
              onClick={() => void download()}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 size={12} className="spin" />
              ) : (
                <Download size={12} />
              )}{" "}
              Tải file gốc
            </button>
          )
        )}
      </div>
    </>
  );
}
