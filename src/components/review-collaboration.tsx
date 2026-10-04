"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  Clock3,
  FileCheck2,
  Handshake,
  MessageSquareText,
  Share2,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useApp } from "./app-provider";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  InlineNotice,
  Input,
  Modal,
  Select,
  Textarea,
} from "./ui";
import type {
  Review,
  ReviewParticipant,
  ReviewPartyDecisionEntry,
  ReviewPartyDecisionType,
} from "@/lib/types";
import { formatDate } from "@/lib/utils";
import {
  demoMockScannedFileIdsFor,
  eligibleDemoMockScanFiles,
} from "@/lib/demo-mock-scan";

const roleLabel = {
  label_owner: "Chủ nhãn",
  commercial_importer: "Nhà nhập khẩu thương mại (Commercial Importer)",
  fsvp_importer: "Nhà nhập khẩu theo FSVP (FSVP Importer)",
} as const;
const participantStatusLabel = {
  invited: "Đang chờ chấp nhận",
  active: "Đang tham gia",
  removed: "Đã thu hồi quyền",
} as const;
const decisionLabel: Record<ReviewPartyDecisionType, string> = {
  accepted: "Chấp nhận phiên bản",
  changes_requested: "Yêu cầu chỉnh sửa",
  proposed_edit: "Đề xuất chỉnh sửa có chú thích",
};
const collaborationStatusLabel = {
  not_shared: "Chưa chia sẻ",
  awaiting_importer: "Chờ nhà nhập khẩu thương mại phản hồi",
  changes_requested: "Cần phiên bản nhãn mới",
  mutually_accepted: "Hai bên đã xác nhận",
} as const;

function hasOwnerAcceptance(
  decisions: ReviewPartyDecisionEntry[],
  owner: ReviewParticipant | undefined,
  review: Review,
) {
  return (
    !!owner &&
    decisions.some(
      (entry) =>
        entry.participant_id === owner.id &&
        entry.party_role === "label_owner" &&
        entry.decision === "accepted" &&
        entry.label_version_id === review.label_version_id,
    )
  );
}

function PartyDecisionCard({
  decision,
}: {
  decision: ReviewPartyDecisionEntry;
}) {
  return (
    <div className="collaboration-history-item">
      <div className="collaboration-history-heading">
        <Badge tone={decision.decision === "accepted" ? "green" : "amber"}>
          {decisionLabel[decision.decision]}
        </Badge>
        <span className="tiny muted">
          {roleLabel[decision.party_role]} · {decision.actor_name_snapshot} ·{" "}
          {formatDate(decision.created_at, true)}
        </span>
      </div>
      <p>{decision.comment}</p>
      <div className="tiny muted">
        Ràng buộc: label version …{decision.label_version_id.slice(-8)} · Mã
        SHA-256 <code>{decision.label_bundle_sha256.slice(0, 12)}…</code>
      </div>
      {decision.proposed_changes.length > 0 && (
        <div className="proposal-list">
          {decision.proposed_changes.map((change, index) => (
            <div className="proposal-item" key={`${decision.id}-${index}`}>
              <strong>{change.field}</strong>
              {change.current_value !== undefined && (
                <div>
                  <span className="muted">Hiện tại: </span>
                  <span>{change.current_value || "(trống)"}</span>
                </div>
              )}
              <div>
                <span className="muted">Đề xuất: </span>
                <span>{change.proposed_value}</span>
              </div>
              <div>
                <span className="muted">Lý do: </span>
                <span>{change.reason}</span>
              </div>
              <p className="tiny muted" style={{ marginBottom: 0 }}>
                Chỉ là đề xuất; không thay đổi file nhãn gốc.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ParticipantAcceptanceModal({
  participant,
  onClose,
}: {
  participant: ReviewParticipant | null;
  onClose: () => void;
}) {
  const app = useApp();
  const [attests, setAttests] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isFsvp = participant?.party_role === "fsvp_importer";
  const accept = async () => {
    if (!participant) return;
    setBusy(true);
    try {
      await app.acceptReviewParticipant(participant.id, attests, note);
      app.notify(
        isFsvp
          ? "Đã lưu xác nhận FSVP riêng cho tổ chức của bạn."
          : "Đã chấp nhận vai trò nhà nhập khẩu thương mại.",
      );
      setAttests(false);
      setNote("");
      onClose();
    } catch (error) {
      app.notify(
        error instanceof Error ? error.message : "Không thể chấp nhận lời mời.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!participant}
      onClose={onClose}
      title={
        isFsvp
          ? "Xác nhận lời mời nhà nhập khẩu theo FSVP"
          : "Chấp nhận lời mời nhà nhập khẩu thương mại"
      }
      description="Chấp nhận lời mời tham gia không đồng nghĩa chấp nhận nội dung nhãn. Quyết định về nhãn được ghi riêng sau khi chủ nhãn chia sẻ đúng phiên bản."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Để sau
          </Button>
          <Button
            loading={busy}
            disabled={
              !participant ||
              app.actor.role !== "customer_admin" ||
              (isFsvp && (!attests || note.trim().length < 10))
            }
            onClick={() => void accept()}
          >
            <Check size={15} /> Chấp nhận lời mời
          </Button>
        </>
      }
    >
      {participant && (
        <div className="collaboration-modal-content">
          <InlineNotice icon={<Handshake size={16} />}>
            Vai trò được mời:{" "}
            <strong>{roleLabel[participant.party_role]}</strong>. Mã lượt rà
            soát: <code>{participant.review_id.slice(-8)}</code>. Chưa có quyền
            xem nhãn; chủ nhãn chỉ chia sẻ sau khi tự rà soát phiên bản.
          </InlineNotice>
          {isFsvp ? (
            <>
              <div style={{ marginTop: 16 }}>
                <Checkbox checked={attests} onChange={setAttests}>
                  Tổ chức của tôi xác nhận mình đang tham gia với tư cách nhà
                  nhập khẩu theo FSVP cho lượt rà soát này.
                </Checkbox>
              </div>
              <Textarea
                label="Căn cứ xác nhận tư cách FSVP"
                required
                minLength={10}
                maxLength={5000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Nêu ngắn gọn cơ sở mà tổ chức xác nhận vai trò này…"
                style={{ marginTop: 16 }}
              />
              <p className="tiny muted">
                Đây là xác nhận độc lập của tổ chức; nhà nhập khẩu thương mại
                không tự động trở thành nhà nhập khẩu theo FSVP.
              </p>
            </>
          ) : (
            <InlineNotice tone="info">
              Chấp nhận vai trò nhà nhập khẩu thương mại không tự xác nhận tư
              cách FSVP. Nếu tổ chức có cả hai vai trò, lời mời FSVP được lưu
              riêng.
            </InlineNotice>
          )}
          {app.actor.role !== "customer_admin" && (
            <p className="tiny muted">
              Chỉ quản trị viên của tổ chức được mời mới có thể chấp nhận lời
              mời.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function CollaborationInbox() {
  const app = useApp();
  const [accepting, setAccepting] = useState<ReviewParticipant | null>(null);
  const entries = useMemo(() => {
    if (!app.actor.organization_id || !app.actor.role.startsWith("customer"))
      return [];
    return (app.data.reviewParticipants ?? [])
      .filter(
        (participant) =>
          participant.organization_id === app.actor.organization_id &&
          participant.party_role !== "label_owner" &&
          participant.status !== "removed" &&
          !app.data.reviews.some(
            (review) => review.id === participant.review_id,
          ),
      )
      .sort((a, b) => b.invited_at.localeCompare(a.invited_at));
  }, [
    app.actor.organization_id,
    app.actor.role,
    app.data.reviewParticipants,
    app.data.reviews,
  ]);
  if (!entries.length) return null;
  return (
    <>
      <Card className="collaboration-inbox">
        <div className="card-header">
          <div className="card-title-group">
            <h2>Lời mời cộng tác nhãn</h2>
            <Badge tone="blue">
              {entries.filter((entry) => entry.status === "invited").length} mới
            </Badge>
          </div>
          <Handshake size={18} color="#6f8c68" />
        </div>
        <p className="tiny muted" style={{ marginTop: -4 }}>
          Chấp nhận lời mời chỉ mở tư cách tham gia. Nhãn và findings chỉ hiển
          thị khi chủ nhãn chia sẻ phiên bản đã rà soát.
        </p>
        <div className="collaboration-inbox-list">
          {entries.map((participant) => (
            <div className="collaboration-inbox-row" key={participant.id}>
              <div>
                <strong>{roleLabel[participant.party_role]}</strong>
                <div className="tiny muted">
                  Lượt rà soát · {participant.review_id.slice(-8)} ·{" "}
                  {formatDate(participant.invited_at, true)}
                </div>
                <Badge
                  tone={participant.status === "invited" ? "amber" : "green"}
                >
                  {participant.status === "invited"
                    ? "Chờ xác nhận"
                    : "Đã nhận · chờ chủ nhãn chia sẻ"}
                </Badge>
              </div>
              {participant.status === "invited" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={app.actor.role !== "customer_admin"}
                  onClick={() => setAccepting(participant)}
                >
                  <Check size={14} /> Xem & chấp nhận
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
      <ParticipantAcceptanceModal
        participant={accepting}
        onClose={() => setAccepting(null)}
      />
    </>
  );
}

export function ReviewCollaborationPanel({ review }: { review: Review }) {
  const app = useApp();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "commercial_importer" | "fsvp_importer"
  >("commercial_importer");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerComment, setOwnerComment] = useState("");
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [demoScanBusy, setDemoScanBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareComment, setShareComment] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decision, setDecision] = useState<ReviewPartyDecisionType>("accepted");
  const [decisionComment, setDecisionComment] = useState("");
  const [proposedChanges, setProposedChanges] = useState<
    ReviewPartyDecisionEntry["proposed_changes"]
  >([]);
  const [changeField, setChangeField] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [proposedValue, setProposedValue] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [removing, setRemoving] = useState<ReviewParticipant | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);

  const participants = (app.data.reviewParticipants ?? []).filter(
    (participant) => participant.review_id === review.id,
  );
  const decisions = (app.data.partyDecisions ?? [])
    .filter((entry) => entry.review_id === review.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const owner = participants.find(
    (participant) =>
      participant.party_role === "label_owner" &&
      participant.organization_id === review.organization_id,
  );
  const myOrgParticipants = participants.filter(
    (participant) =>
      participant.organization_id === app.actor.organization_id &&
      participant.status === "active",
  );
  const myOwnerParticipant = myOrgParticipants.find(
    (participant) => participant.party_role === "label_owner",
  );
  const myCommercialParticipant = myOrgParticipants.find(
    (participant) => participant.party_role === "commercial_importer",
  );
  const collaborationStatus = review.collaboration_status ?? "not_shared";
  const ownerAccepted = hasOwnerAcceptance(decisions, owner, review);
  const label = app.data.labelVersions.find(
    (version) => version.id === review.label_version_id,
  );
  const originals =
    label?.original_files.filter((file) => file.kind === "original") ?? [];
  const mockableOriginals = label
    ? eligibleDemoMockScanFiles(review, label)
    : null;
  const mockScannedIds = label
    ? demoMockScannedFileIdsFor(review, label, app.demoMockScans)
    : new Set<string>();
  const mockScanComplete =
    !!mockableOriginals && mockScannedIds.size === mockableOriginals.length;
  const mockScanRecord =
    label && mockScanComplete ? app.demoMockScans[label.id] : undefined;
  const originalsReady =
    originals.length > 0 &&
    originals.every(
      (file) =>
        file.scan_status === "clean" ||
        (app.mode === "demo" && mockScannedIds.has(file.id)),
    );
  const mockScanAvailable = app.mode === "demo" && !!mockableOriginals;
  const ownerMember =
    !!myOwnerParticipant &&
    app.actor.organization_id === review.organization_id;
  const ownerAdmin = ownerMember && app.actor.role === "customer_admin";
  const canManageParticipants = ownerAdmin || app.actor.role === "system_admin";
  const liveCommercial = participants.find(
    (participant) =>
      participant.party_role === "commercial_importer" &&
      participant.status !== "removed",
  );
  const liveFsvp = participants.find(
    (participant) =>
      participant.party_role === "fsvp_importer" &&
      participant.status !== "removed",
  );
  const availableInviteRoles: ("commercial_importer" | "fsvp_importer")[] = [];
  if (collaborationStatus === "not_shared" && !liveCommercial)
    availableInviteRoles.push("commercial_importer");
  if (!liveFsvp) availableInviteRoles.push("fsvp_importer");
  const inviteEmailAddress = inviteEmail.trim();
  const inviteEmailParts = inviteEmailAddress.split("@");
  const inviteEmailValid =
    inviteEmailAddress.length <= 254 &&
    !inviteEmailAddress.includes(" ") &&
    inviteEmailParts.length === 2 &&
    !!inviteEmailParts[0] &&
    !!inviteEmailParts[1]?.includes(".");
  const commercialActive = participants.some(
    (participant) =>
      participant.party_role === "commercial_importer" &&
      participant.status === "active",
  );
  const canShare =
    ownerAdmin &&
    collaborationStatus === "not_shared" &&
    ownerAccepted &&
    commercialActive &&
    originalsReady &&
    ["AI_REVIEW_READY", "HUMAN_REVIEW", "REVISION_REQUIRED"].includes(
      review.status,
    );
  const canRespondAsImporter =
    !!myCommercialParticipant &&
    ["awaiting_importer", "changes_requested"].includes(collaborationStatus) &&
    originalsReady;
  const canAcceptAsImporter =
    canRespondAsImporter &&
    app.actor.role === "customer_admin" &&
    collaborationStatus === "awaiting_importer";

  const runDemoScan = async () => {
    setDemoScanBusy(true);
    try {
      await app.runDemoMockScan(review.id);
      app.notify(
        "Mock Scan demo hoàn tất. File vẫn mang scan_status dev_unscanned; đây không phải kết quả antivirus thật.",
        "info",
      );
    } catch (error) {
      app.notify(
        error instanceof Error
          ? error.message
          : "Không thể chạy Mock Scan demo.",
        "error",
      );
    } finally {
      setDemoScanBusy(false);
    }
  };

  const submitInvite = async () => {
    setInviteBusy(true);
    try {
      await app.inviteReviewParticipant(review.id, inviteEmail, inviteRole);
      app.notify(
        "Đã tạo lời mời cho tổ chức đã đăng ký. Không tạo tài khoản Auth hoặc gửi email tự động.",
      );
      setInviteOpen(false);
      setInviteEmail("");
    } catch (error) {
      app.notify(
        error instanceof Error ? error.message : "Không thể tạo lời mời.",
        "error",
      );
    } finally {
      setInviteBusy(false);
    }
  };
  const submitOwnerDecision = async () => {
    setOwnerBusy(true);
    try {
      await app.recordPartyDecision(
        review.id,
        "label_owner",
        "accepted",
        ownerComment,
      );
      app.notify("Đã lưu xác nhận của chủ nhãn cho phiên bản hiện tại.");
      setOwnerOpen(false);
      setOwnerComment("");
    } catch (error) {
      app.notify(
        error instanceof Error ? error.message : "Không thể lưu xác nhận.",
        "error",
      );
    } finally {
      setOwnerBusy(false);
    }
  };
  const submitShare = async () => {
    setShareBusy(true);
    try {
      await app.shareReview(review.id, shareComment);
      app.notify(
        "Đã chia sẻ đúng phiên bản nhãn với nhà nhập khẩu thương mại.",
      );
      setShareOpen(false);
      setShareComment("");
    } catch (error) {
      app.notify(
        error instanceof Error
          ? error.message
          : "Không thể chia sẻ lượt rà soát.",
        "error",
      );
    } finally {
      setShareBusy(false);
    }
  };
  const submitDecision = async () => {
    setDecisionBusy(true);
    try {
      await app.recordPartyDecision(
        review.id,
        "commercial_importer",
        decision,
        decisionComment,
        decision === "proposed_edit" ? proposedChanges : [],
      );
      app.notify(
        decision === "accepted"
          ? "Đã chấp nhận đúng phiên bản nhãn hiện tại."
          : "Đã gửi phản hồi; file nhãn gốc không bị ghi đè.",
      );
      setDecisionOpen(false);
      setDecisionComment("");
      setProposedChanges([]);
      setChangeField("");
      setCurrentValue("");
      setProposedValue("");
      setChangeReason("");
    } catch (error) {
      app.notify(
        error instanceof Error ? error.message : "Không thể lưu phản hồi.",
        "error",
      );
    } finally {
      setDecisionBusy(false);
    }
  };
  const addProposedChange = () => {
    const change = {
      field: changeField.trim(),
      ...(currentValue.trim() ? { current_value: currentValue.trim() } : {}),
      proposed_value: proposedValue.trim(),
      reason: changeReason.trim(),
    };
    if (
      !change.field ||
      change.field.length > 200 ||
      !change.proposed_value ||
      change.proposed_value.length > 5000 ||
      change.reason.length < 5 ||
      change.reason.length > 2000 ||
      (change.current_value?.length ?? 0) > 5000
    ) {
      app.notify(
        "Hoàn thiện trường, nội dung đề xuất và lý do trước khi thêm.",
        "error",
      );
      return;
    }
    setProposedChanges((items) => [...items, change]);
    setChangeField("");
    setCurrentValue("");
    setProposedValue("");
    setChangeReason("");
  };
  const submitRemoval = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await app.removeReviewParticipant(removing.id, removeReason);
      app.notify("Đã thu hồi quyền truy cập lượt rà soát.");
      setRemoving(null);
      setRemoveReason("");
    } catch (error) {
      app.notify(
        error instanceof Error ? error.message : "Không thể thu hồi quyền.",
        "error",
      );
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <Card className="review-collaboration-card">
      <div className="card-header collaboration-card-header">
        <div className="card-title-group">
          <span className="collaboration-title-icon">
            <Handshake size={18} />
          </span>
          <div>
            <h2>Quyết định giữa các bên</h2>
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>
              Rà soát của doanh nghiệp · Nhãn v{label?.version ?? "?"}
            </p>
          </div>
        </div>
        <Badge
          tone={
            collaborationStatus === "mutually_accepted"
              ? "green"
              : collaborationStatus === "changes_requested"
                ? "amber"
                : "blue"
          }
        >
          {collaborationStatusLabel[collaborationStatus]}
        </Badge>
      </div>
      <div className="collaboration-workflow-note">
        <ShieldCheck size={16} />
        <span>
          Chủ nhãn xem xét trước; nhà nhập khẩu thương mại chỉ phản hồi sau khi
          được chia sẻ. Mỗi quyết định gắn với đúng phiên bản và mã SHA-256 (dấu
          vân tay số) của file gốc. Đề xuất không sửa nhãn. Quy trình này độc
          lập với báo cáo chuyên môn Vexim và không phải phê duyệt của FDA.
        </span>
      </div>
      {mockScanAvailable && (
        <>
          <div className="demo-collaboration-guide">
            <div className="demo-collaboration-guide-heading">
              <Badge tone="amber">DEMO ONLY</Badge>
              <strong>Thử luồng Chủ nhãn → Nhà nhập khẩu thương mại</strong>
            </div>
            <p className="tiny muted">
              Chạy mô phỏng quét, rồi vào Cài đặt chọn Hoàng Nam · Mộc Trà Việt
              để mời <code>contact@annhientea.example</code> và xác nhận; đổi
              sang Minh Anh · An Nhiên Tea để nhận lời mời; quay lại chủ nhãn để
              chia sẻ, sau đó nhà nhập khẩu thương mại xác nhận đúng phiên bản.
            </p>
            <Link href="/settings" className="demo-collaboration-settings-link">
              Mở Cài đặt để chọn persona demo
            </Link>
          </div>
          <div className="demo-mock-scan-card" data-testid="demo-mock-scan">
            <div className="demo-mock-scan-heading">
              <div>
                <h3>Quét mô phỏng · nhãn mẫu</h3>
                <span className="tiny muted">
                  {mockableOriginals?.length ?? 0} file nhãn mẫu · chỉ áp dụng
                  trong Demo cục bộ
                </span>
              </div>
              <Badge tone="amber">
                {mockScanComplete ? "MÔ PHỎNG ĐÃ CHẠY" : "CHƯA MÔ PHỎNG"}
              </Badge>
            </div>
            <InlineNotice tone="warning" icon={<ShieldCheck size={15} />}>
              <strong>Không phải quét mã độc thật.</strong> Tác vụ này chỉ mô
              phỏng kết quả cho nhãn mẫu tĩnh để thử luồng cộng tác. Không gọi
              ClamAV, không thay đổi <code>scan_status: dev_unscanned</code>,
              không quét file tải lên và không gửi dữ liệu lên Supabase. Không
              có giá trị cho môi trường thật hoặc báo cáo Vexim.
            </InlineNotice>
            <div className="demo-mock-scan-files">
              {mockableOriginals?.map((file) => (
                <div className="demo-mock-scan-file" key={file.id}>
                  <span>{file.name}</span>
                  <Badge
                    tone={mockScannedIds.has(file.id) ? "amber" : "neutral"}
                  >
                    {mockScannedIds.has(file.id)
                      ? "Mô phỏng · không phải trạng thái sạch thật"
                      : `scan_status: ${file.scan_status}`}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="demo-mock-scan-footer">
              {mockScanRecord && (
                <span className="tiny muted">
                  Mô phỏng lúc {formatDate(mockScanRecord.completed_at, true)} ·
                  tạm lưu trong phiên trình duyệt.
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                loading={demoScanBusy}
                onClick={() => void runDemoScan()}
              >
                <ShieldCheck size={14} />
                {mockScanComplete
                  ? "Chạy lại mô phỏng quét"
                  : "Chạy mô phỏng quét trong Demo"}
              </Button>
            </div>
          </div>
        </>
      )}
      {!originalsReady && !mockScanAvailable && (
        <InlineNotice tone="warning" icon={<Clock3 size={15} />}>
          Chưa thể ghi nhận hoặc chia sẻ quyết định: mọi file gốc phải được quét
          mã độc thật và có trạng thái <strong>sạch</strong>. Mô phỏng quét chỉ
          dùng cho nhãn mẫu có sẵn trong Demo; file tải lên và môi trường
          Supabase vẫn cần kết quả quét thật.
        </InlineNotice>
      )}

      <div className="collaboration-party-grid">
        <div className="collaboration-party-card">
          <div className="collaboration-party-heading">
            <strong>Chủ nhãn</strong>
            <Badge tone={owner?.status === "active" ? "green" : "neutral"}>
              {owner?.organization_name_snapshot ?? "Chưa được khởi tạo"}
            </Badge>
          </div>
          <p className="tiny muted">
            Rà soát và xác nhận phiên bản trước khi chia sẻ. Đây là quyết định
            của doanh nghiệp sở hữu nhãn, không phải của nhà nhập khẩu thương
            mại hay Vexim.
          </p>
          {ownerAccepted ? (
            <InlineNotice tone="success" icon={<BadgeCheck size={15} />}>
              Chủ nhãn đã xác nhận nhãn v{label?.version}.
            </InlineNotice>
          ) : ownerMember && collaborationStatus === "not_shared" ? (
            <Button
              variant="secondary"
              disabled={!originalsReady}
              onClick={() => setOwnerOpen(true)}
            >
              <FileCheck2 size={15} /> Xác nhận đã rà soát
            </Button>
          ) : (
            <span className="tiny muted">
              {owner?.status === "active"
                ? "Đang chờ chủ nhãn xác nhận."
                : "Chưa có chủ nhãn hoạt động."}
            </span>
          )}
        </div>

        <div className="collaboration-party-card">
          <div className="collaboration-party-heading">
            <strong>Nhà nhập khẩu thương mại</strong>
            <Badge tone={commercialActive ? "green" : "neutral"}>
              {commercialActive
                ? "Đã tham gia"
                : liveCommercial
                  ? "Chờ chấp nhận"
                  : "Chưa mời"}
            </Badge>
          </div>
          <p className="tiny muted">
            Vai trò thương mại riêng. Chỉ lời mời này mới có quyền phản hồi và
            xác nhận nhãn.
          </p>
          {myCommercialParticipant && canRespondAsImporter && (
            <Button
              variant="secondary"
              disabled={decisionBusy}
              onClick={() => {
                setDecision(
                  collaborationStatus === "awaiting_importer" &&
                    app.actor.role === "customer_admin"
                    ? "accepted"
                    : "changes_requested",
                );
                setDecisionOpen(true);
              }}
            >
              <MessageSquareText size={15} /> Phản hồi phiên bản
            </Button>
          )}
          {collaborationStatus === "mutually_accepted" && (
            <InlineNotice tone="success">
              Nhà nhập khẩu thương mại đã chấp nhận cùng phiên bản mà chủ nhãn
              xác nhận.
            </InlineNotice>
          )}
        </div>

        <div className="collaboration-party-card">
          <div className="collaboration-party-heading">
            <strong>Nhà nhập khẩu theo FSVP</strong>
            <Badge tone={liveFsvp?.status === "active" ? "green" : "neutral"}>
              {liveFsvp?.status === "active"
                ? "Đã attested riêng"
                : liveFsvp
                  ? "Chờ chấp nhận"
                  : "Chưa mời"}
            </Badge>
          </div>
          <p className="tiny muted">
            Vai trò này được lưu độc lập. Nhà nhập khẩu thương mại không được
            suy diễn thành nhà nhập khẩu theo FSVP.
          </p>
          {liveFsvp?.fsvp_attested_at && (
            <span className="tiny muted">
              Xác nhận lúc {formatDate(liveFsvp.fsvp_attested_at, true)}
            </span>
          )}
        </div>
      </div>

      {(canManageParticipants || myCommercialParticipant) && (
        <div className="collaboration-participant-section">
          <div className="collaboration-section-heading">
            <h3>Người tham gia</h3>
            {canManageParticipants && availableInviteRoles.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setInviteRole(availableInviteRoles[0]);
                  setInviteOpen(true);
                }}
              >
                <UserPlus size={14} /> Mời đơn vị nhập khẩu
              </Button>
            )}
          </div>
          <div className="collaboration-participant-list">
            {participants.map((participant) => (
              <div
                className="collaboration-participant-row"
                key={participant.id}
              >
                <div>
                  <strong>{participant.organization_name_snapshot}</strong>
                  <span className="tiny muted">
                    {roleLabel[participant.party_role]}
                  </span>
                </div>
                <div className="collaboration-participant-status">
                  <Badge
                    tone={
                      participant.status === "active"
                        ? "green"
                        : participant.status === "invited"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {participantStatusLabel[participant.status]}
                  </Badge>
                  {participant.party_role === "fsvp_importer" &&
                    participant.fsvp_attested_at && (
                      <span className="tiny muted">
                        Đã xác nhận tư cách FSVP
                      </span>
                    )}
                  {canManageParticipants &&
                    participant.party_role !== "label_owner" &&
                    participant.status !== "removed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRemoving(participant)}
                      >
                        <X size={13} /> Thu hồi
                      </Button>
                    )}
                </div>
              </div>
            ))}
            {!participants.length && (
              <span className="tiny muted">Chưa có người tham gia.</span>
            )}
          </div>
        </div>
      )}

      {ownerAdmin && collaborationStatus === "not_shared" && (
        <div className="collaboration-share-row">
          <div>
            <strong>Sẵn sàng chia sẻ?</strong>
            <p className="tiny muted">
              Cần chủ nhãn xác nhận, commercial nhà nhập khẩu thương mại đã chấp
              nhận lời mời và file gốc đã được quét hợp lệ (mô phỏng quét chỉ
              dùng trong Demo cục bộ).
            </p>
          </div>
          <Button disabled={!canShare} onClick={() => setShareOpen(true)}>
            <Share2 size={15} /> Chia sẻ phiên bản
          </Button>
        </div>
      )}

      {collaborationStatus === "changes_requested" && (
        <InlineNotice tone="warning">
          Importer đã yêu cầu thay đổi hoặc gửi đề xuất. Không thể chấp nhận lại
          phiên bản này; hãy tải lên phiên bản nhãn mới và bắt đầu lượt rà soát
          mới để cả hai bên xác nhận lại.
        </InlineNotice>
      )}
      {collaborationStatus === "awaiting_importer" &&
        !myCommercialParticipant && (
          <InlineNotice tone="info">
            Đã chia sẻ phiên bản cụ thể với nhà nhập khẩu thương mại; đang chờ
            phản hồi. Vexim không tự thay mặt hai bên chấp thuận nhãn.
          </InlineNotice>
        )}
      {collaborationStatus === "mutually_accepted" && (
        <InlineNotice tone="success">
          Hai bên đã xác nhận cùng phiên bản nhãn. Đây không phải kết luận của
          FDA và không thay thế nghĩa vụ pháp lý của mỗi tổ chức.
        </InlineNotice>
      )}

      {decisions.length > 0 && (
        <div className="collaboration-history">
          <div className="collaboration-section-heading">
            <h3>Lịch sử quyết định bất biến</h3>
            <span className="tiny muted">Chỉ bổ sung; không chỉnh sửa/xóa</span>
          </div>
          {decisions.map((entry) => (
            <PartyDecisionCard key={entry.id} decision={entry} />
          ))}
        </div>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Mời đơn vị nhập khẩu tham gia rà soát"
        description="Chỉ gửi lời mời đến email liên hệ của tổ chức đã đăng ký. Hệ thống không tạo Auth user và không gửi email tự động."
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={inviteBusy}
              disabled={!inviteEmailValid}
              onClick={() => void submitInvite()}
            >
              <UserPlus size={15} /> Tạo lời mời
            </Button>
          </>
        }
      >
        <Select
          label="Năng lực tham gia"
          value={inviteRole}
          onChange={(event) =>
            setInviteRole(event.target.value as typeof inviteRole)
          }
        >
          {availableInviteRoles.map((role) => (
            <option value={role} key={role}>
              {roleLabel[role]}
            </option>
          ))}
        </Select>
        <Input
          label="Email liên hệ đã đăng ký của tổ chức"
          type="email"
          required
          maxLength={254}
          value={inviteEmail}
          onChange={(event) => setInviteEmail(event.target.value)}
          placeholder="contact@example.com"
          hint="Email phải khớp chính xác với một tổ chức đang hoạt động trong hệ thống."
        />
        <InlineNotice tone="info">
          Lời mời chỉ được lưu trong hệ thống để quản trị viên của tổ chức đó
          chấp nhận. Hãy báo cho họ qua kênh doanh nghiệp đã xác minh.
        </InlineNotice>
      </Modal>

      <Modal
        open={ownerOpen}
        onClose={() => setOwnerOpen(false)}
        title="Chủ nhãn xác nhận đã rà soát"
        description={`Quyết định chỉ áp dụng cho nhãn v${label?.version ?? "?"} và mã SHA-256 của danh sách file gốc hiện tại. Không đánh dấu mọi phát hiện là đã xử lý.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOwnerOpen(false)}>
              Quay lại
            </Button>
            <Button
              loading={ownerBusy}
              disabled={!originalsReady || ownerComment.trim().length < 5}
              onClick={() => void submitOwnerDecision()}
            >
              <FileCheck2 size={15} /> Lưu xác nhận chủ nhãn
            </Button>
          </>
        }
      >
        <InlineNotice icon={<FileCheck2 size={15} />}>
          Xác nhận này ghi nhận việc doanh nghiệp đã tự xem xét nhãn phiên bản
          hiện tại. Nhà nhập khẩu thương mại chưa được chia sẻ nhãn và chưa thể
          chấp nhận thay chủ nhãn.
        </InlineNotice>
        <Textarea
          label="Ghi chú rà soát của chủ nhãn"
          required
          minLength={5}
          maxLength={10000}
          value={ownerComment}
          onChange={(event) => setOwnerComment(event.target.value)}
          placeholder="Nêu căn cứ doanh nghiệp đã kiểm tra phiên bản này…"
          style={{ marginTop: 16 }}
        />
      </Modal>

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Chia sẻ phiên bản đã được chủ nhãn rà soát"
        description="Sau khi chia sẻ, nhà nhập khẩu thương mại được xem dữ liệu rà soát trong phạm vi này. Chia sẻ không làm thay đổi file gốc."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShareOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={shareBusy}
              disabled={!canShare || shareComment.trim().length < 5}
              onClick={() => void submitShare()}
            >
              <Share2 size={15} /> Chia sẻ đúng phiên bản
            </Button>
          </>
        }
      >
        <InlineNotice tone="warning">
          Chỉ chia sẻ phiên bản đã được chủ nhãn rà soát trước. Quyết định của
          nhà nhập khẩu thương mại sẽ gắn với cùng phiên bản nhãn và mã SHA-256
          của file gốc.
        </InlineNotice>
        <Textarea
          label="Lý do / phạm vi chia sẻ"
          required
          minLength={5}
          maxLength={5000}
          value={shareComment}
          onChange={(event) => setShareComment(event.target.value)}
          placeholder="Nêu mục đích chia sẻ cho nhà nhập khẩu thương mại…"
          style={{ marginTop: 16 }}
        />
      </Modal>

      <Modal
        open={decisionOpen}
        onClose={() => setDecisionOpen(false)}
        title="Nhà nhập khẩu thương mại phản hồi nhãn"
        description={`Nhà nhập khẩu thương mại đang xem nhãn v${label?.version ?? "?"}. Chỉ có thể chấp nhận khi chưa yêu cầu thay đổi cho phiên bản này.`}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecisionOpen(false)}>
              Đóng
            </Button>
            <Button
              loading={decisionBusy}
              disabled={
                !canRespondAsImporter ||
                decisionComment.trim().length < 5 ||
                (decision === "accepted" && !canAcceptAsImporter) ||
                (decision === "proposed_edit" && proposedChanges.length === 0)
              }
              onClick={() => void submitDecision()}
            >
              <Check size={15} /> Ghi nhận phản hồi
            </Button>
          </>
        }
      >
        <Select
          label="Quyết định"
          value={decision}
          onChange={(event) =>
            setDecision(event.target.value as ReviewPartyDecisionType)
          }
        >
          <option value="accepted" disabled={!canAcceptAsImporter}>
            Chấp nhận đúng phiên bản
          </option>
          <option value="changes_requested">Yêu cầu chủ nhãn chỉnh sửa</option>
          <option value="proposed_edit">Đề xuất chỉnh sửa có chú thích</option>
        </Select>
        {!canAcceptAsImporter && decision === "accepted" && (
          <InlineNotice tone="warning">
            Chỉ quản trị viên của nhà nhập khẩu thương mại mới có thể chấp nhận.
            Nếu trước đó đã yêu cầu thay đổi, cần tạo review cycle mới cho phiên
            bản nhãn mới.
          </InlineNotice>
        )}
        <Textarea
          label="Nhận xét của nhà nhập khẩu thương mại"
          required
          minLength={5}
          maxLength={10000}
          value={decisionComment}
          onChange={(event) => setDecisionComment(event.target.value)}
          placeholder="Giải thích quyết định và các điểm cần lưu ý…"
          style={{ marginTop: 16 }}
        />
        {decision === "proposed_edit" && (
          <div className="proposal-editor">
            <h3>Chú thích đề xuất</h3>
            <p className="tiny muted">
              Mỗi đề xuất được lưu riêng. Không sửa file nhãn gốc hoặc dữ liệu
              đã trích xuất.
            </p>
            <div className="proposal-form-grid">
              <Input
                label="Trường / vị trí"
                value={changeField}
                maxLength={200}
                onChange={(event) => setChangeField(event.target.value)}
                placeholder="ingredient_declaration"
              />
              <Input
                label="Nội dung hiện tại (tùy chọn)"
                value={currentValue}
                maxLength={5000}
                onChange={(event) => setCurrentValue(event.target.value)}
              />
              <Input
                label="Nội dung đề xuất"
                value={proposedValue}
                maxLength={5000}
                onChange={(event) => setProposedValue(event.target.value)}
              />
              <Input
                label="Lý do đề xuất"
                value={changeReason}
                maxLength={2000}
                onChange={(event) => setChangeReason(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={proposedChanges.length >= 50}
              onClick={addProposedChange}
            >
              Thêm chú thích
            </Button>
            {proposedChanges.length > 0 && (
              <div className="proposal-list">
                {proposedChanges.map((change, index) => (
                  <div
                    className="proposal-item"
                    key={`${change.field}-${index}`}
                  >
                    <div className="collaboration-section-heading">
                      <strong>{change.field}</strong>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Xóa đề xuất ${change.field}`}
                        onClick={() =>
                          setProposedChanges((items) =>
                            items.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={13} />
                      </Button>
                    </div>
                    {change.current_value && (
                      <div>Hiện tại: {change.current_value}</div>
                    )}
                    <div>Đề xuất: {change.proposed_value}</div>
                    <div className="tiny muted">Lý do: {change.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Thu hồi quyền truy cập lượt rà soát"
        description="Quyền xem nhãn và lượt rà soát sẽ bị thu hồi ngay. Lịch sử quyết định đã ghi nhận được giữ nguyên."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Hủy
            </Button>
            <Button
              variant="danger"
              loading={removeBusy}
              disabled={removeReason.trim().length < 5}
              onClick={() => void submitRemoval()}
            >
              <X size={14} /> Thu hồi quyền
            </Button>
          </>
        }
      >
        {removing && (
          <>
            <InlineNotice tone="warning">
              Thu hồi vai trò {roleLabel[removing.party_role]} của{" "}
              {removing.organization_name_snapshot}?
            </InlineNotice>
            <Textarea
              label="Lý do thu hồi"
              required
              minLength={5}
              maxLength={5000}
              value={removeReason}
              onChange={(event) => setRemoveReason(event.target.value)}
              style={{ marginTop: 16 }}
            />
          </>
        )}
      </Modal>
    </Card>
  );
}
