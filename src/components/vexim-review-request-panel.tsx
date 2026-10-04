"use client";

import { FileCheck2, ShieldCheck } from "lucide-react";
import { useApp } from "./app-provider";
import { Badge, Button, Card, InlineNotice } from "./ui";
import type { Review } from "@/lib/types";
import { can } from "@/lib/permissions";
import { formatDate, errorMessage } from "@/lib/utils";
import { isSyntheticDemoReview } from "@/lib/demo-review";

const requestStatus = {
  REQUESTED: { label: "Đã gửi yêu cầu Vexim Review", tone: "blue" as const },
  IN_PROGRESS: {
    label: "Vexim Review đang được xử lý",
    tone: "purple" as const,
  },
  COMPLETED: { label: "Vexim Review đã hoàn tất", tone: "green" as const },
};

export function VeximReviewRequestPanel({ review }: { review: Review }) {
  const app = useApp();
  const demoFixture = isSyntheticDemoReview(review);
  const request = demoFixture
    ? undefined
    : app.data.veximReviewRequests?.find(
        (candidate) =>
          candidate.review_id === review.id &&
          candidate.label_version_id === review.label_version_id,
      );
  const customerAdmin = app.actor.role === "customer_admin";
  const isOwner =
    customerAdmin && app.actor.organization_id === review.organization_id;
  const isCommercialImporter =
    customerAdmin &&
    (app.data.reviewParticipants ?? []).some(
      (participant) =>
        participant.review_id === review.id &&
        participant.organization_id === app.actor.organization_id &&
        participant.party_role === "commercial_importer" &&
        participant.status === "active",
    ) &&
    (review.collaboration_status ?? "not_shared") !== "not_shared";
  const canRequest = isOwner || isCommercialImporter;
  const pipelineReady =
    review.pipeline.length >= 5 &&
    review.pipeline.every((step) => step.status === "complete");
  const reportExists = app.data.reports.some(
    (report) => report.review_id === review.id,
  );
  const label = app.data.labelVersions.find(
    (candidate) => candidate.id === review.label_version_id,
  );
  const originals =
    label?.original_files.filter((file) => file.kind === "original") ?? [];
  const realScanReady =
    originals.length > 0 &&
    originals.every(
      (file) =>
        file.scan_status === "clean" && /^[a-f0-9]{64}$/.test(file.sha256),
    );
  const requestReady =
    canRequest &&
    !demoFixture &&
    !request &&
    !reportExists &&
    pipelineReady &&
    realScanReady &&
    ![
      "DRAFT",
      "PROCESSING",
      "PROCESSING_FAILED",
      "MODEL_FAILED",
      "COMPLETED",
      "APPROVED_WITH_NOTES",
      "ARCHIVED",
    ].includes(review.status);
  const createRequest = async () => {
    try {
      const created = await app.requestVeximReview(review.id);
      app.notify(
        `Đã gửi yêu cầu Vexim Review cho nhãn v${app.data.labelVersions.find((label) => label.id === created.label_version_id)?.version ?? "?"}.`,
      );
    } catch (error) {
      app.notify(errorMessage(error), "error");
    }
  };
  const startRequest = async () => {
    if (!request) return;
    try {
      await app.startVeximReviewRequest(request.id);
      app.notify("Chuyên viên đã bắt đầu xử lý yêu cầu Vexim Review.");
    } catch (error) {
      app.notify(errorMessage(error), "error");
    }
  };

  return (
    <Card
      style={{ marginBottom: 16, padding: 16 }}
      data-testid="vexim-request-panel"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="tiny muted">
            YÊU CẦU VEXIM REVIEW · QUY TRÌNH RIÊNG
          </div>
          <h3 style={{ margin: "5px 0 0" }}>Yêu cầu Vexim Review</h3>
        </div>
        {request && (
          <Badge tone={requestStatus[request.status].tone}>
            {requestStatus[request.status].label}
          </Badge>
        )}
      </div>

      {request ? (
        <div style={{ marginTop: 12 }}>
          <div className="tiny muted">
            Nhãn v
            {app.data.labelVersions.find(
              (label) => label.id === request.label_version_id,
            )?.version ?? "?"}
            {" · "}
            Người yêu cầu:{" "}
            {request.requested_role === "label_owner"
              ? "Chủ nhãn"
              : "Nhà nhập khẩu thương mại"}
            {" · "}
            {formatDate(request.requested_at)}
          </div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            Mã SHA-256 (dấu vân tay số của tệp nhãn):{" "}
            <code>{request.artwork_hash}</code>
          </div>
          {request.status === "REQUESTED" && can(app.actor, "review") && (
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => void startRequest()}>
                <ShieldCheck size={14} /> Bắt đầu xử lý yêu cầu Vexim Review
              </Button>
            </div>
          )}
          {request.status === "IN_PROGRESS" && (
            <div className="tiny muted" style={{ marginTop: 10 }}>
              Yêu cầu này gắn với đúng phiên bản nhãn và mã SHA-256 (dấu vân tay
              số của tệp) đã xác minh.
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <InlineNotice tone="info">
            <strong>Chưa có yêu cầu Vexim Review.</strong> Self-check và phân
            luồng chỉ là kết quả nội bộ; không có nghĩa Vexim đã nhận hồ sơ. Chỉ
            gửi yêu cầu riêng khi Chủ nhãn hoặc Nhà nhập khẩu thương mại chủ
            động yêu cầu.
          </InlineNotice>
          {canRequest && !demoFixture && (
            <div style={{ marginTop: 12 }}>
              <Button
                disabled={!requestReady}
                onClick={() => void createRequest()}
              >
                <FileCheck2 size={14} /> Gửi yêu cầu Vexim Review
              </Button>
              {!pipelineReady && (
                <div className="tiny muted" style={{ marginTop: 7 }}>
                  Quy trình Self-check cần hoàn tất trước khi gửi yêu cầu Vexim
                  Review.
                </div>
              )}
              {!realScanReady && (
                <div className="tiny muted" style={{ marginTop: 7 }}>
                  File nhãn gốc cần được quét phần mềm độc hại thật và có trạng
                  thái sạch; quét mô phỏng trong Demo không đủ điều kiện.
                </div>
              )}
              {reportExists && (
                <div className="tiny muted" style={{ marginTop: 7 }}>
                  Lượt rà soát này đã có báo cáo; muốn gửi yêu cầu mới cần một
                  lượt rà soát riêng cho phiên bản nhãn tương ứng.
                </div>
              )}
            </div>
          )}
          {demoFixture && (
            <div className="tiny muted" style={{ marginTop: 9 }}>
              Hồ sơ DRAFT này chỉ dành cho rà soát độc lập; không thể gửi yêu
              cầu Vexim Review.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
