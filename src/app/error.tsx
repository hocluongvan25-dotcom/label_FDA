"use client";

import { useEffect } from "react";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace error:", error.digest ?? error.name);
  }, [error]);
  return (
    <div className="connection-error">
      <h1>Không mở được workspace</h1>
      <p>Vui lòng thử tải lại. Dữ liệu đã lưu không bị xóa.</p>
      <button className="btn btn-primary" onClick={reset}>
        Thử lại
      </button>
    </div>
  );
}
