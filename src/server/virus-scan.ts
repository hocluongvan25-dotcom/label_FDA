import net from "node:net";

export class UnsafeFileError extends Error {
  readonly terminal = true;
  constructor(message: string) {
    super(message);
    this.name = "UnsafeFileError";
  }
}
async function writeChunk(socket: net.Socket, chunk: Uint8Array) {
  if (socket.destroyed) throw new Error("Scanner socket closed.");
  if (socket.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const clean = () => {
      socket.off("drain", drain);
      socket.off("error", error);
      socket.off("close", close);
    };
    const drain = () => {
      clean();
      resolve();
    };
    const error = () => {
      clean();
      reject(new Error("Scanner stream error."));
    };
    const close = () => {
      clean();
      reject(new Error("Scanner stream closed."));
    };
    socket.once("drain", drain);
    socket.once("error", error);
    socket.once("close", close);
  });
}
/**
 * Non-destructive reachability probe (clamd `zPING`).
 * "Configured" only means an env var exists; only a successful PONG proves the
 * daemon is reachable from wherever the worker runs.
 */
export async function pingScanner(): Promise<{
  configured: boolean;
  reachable: boolean;
  version: string | null;
  detail: string;
}> {
  const host = process.env.CLAMAV_HOST;
  if (!host)
    return {
      configured: false,
      reachable: false,
      version: null,
      detail:
        "CLAMAV_HOST chưa được đặt. File gốc sẽ không vượt qua bước validation.",
    };
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let reply = "";
    let settled = false;
    const finish = (result: Awaited<ReturnType<typeof pingScanner>>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(5000, () =>
      finish({
        configured: true,
        reachable: false,
        version: null,
        detail: `Không nhận được phản hồi từ ${host}:${port} trong 5 giây.`,
      }),
    );
    socket.on("error", () =>
      finish({
        configured: true,
        reachable: false,
        version: null,
        detail: `Không kết nối được ClamAV tại ${host}:${port}.`,
      }),
    );
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (/PONG/.test(reply)) {
        const version = /ClamAV\s+([\d.]+)/.exec(reply)?.[1] ?? null;
        finish({
          configured: true,
          reachable: true,
          version,
          detail: version
            ? `ClamAV ${version} phản hồi PONG tại ${host}:${port}.`
            : `ClamAV phản hồi PONG tại ${host}:${port}.`,
        });
      }
    });
    socket.on("close", () =>
      finish({
        configured: true,
        reachable: false,
        version: null,
        detail: `ClamAV tại ${host}:${port} đóng kết nối trước khi trả PONG.`,
      }),
    );
    socket.on("connect", () => {
      socket.write("zPING\0");
    });
  });
}

export async function scanFile(
  bytes: Uint8Array,
): Promise<"clean" | "dev_unscanned"> {
  const host = process.env.CLAMAV_HOST;
  if (!host) {
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.ALLOW_UNSCANNED_DEV_UPLOADS === "true"
    )
      return "dev_unscanned";
    throw new Error(
      "Malware scanner chưa được cấu hình. Pipeline không xử lý nhãn thật khi thiếu ClamAV.",
    );
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host,
      port: Number(process.env.CLAMAV_PORT ?? 3310),
    });
    let reply = "";
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(error);
      }
    };
    socket.setTimeout(30_000, () =>
      fail(new Error("Malware scanner timeout (30s).")),
    );
    socket.on("error", () => fail(new Error("Không kết nối được ClamAV.")));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.length > 4096)
        return fail(new Error("ClamAV response vượt giới hạn."));
      if (/FOUND/.test(reply))
        return fail(
          new UnsafeFileError(
            "ClamAV phát hiện malware. File bị chặn; không gửi tới OCR / model.",
          ),
        );
      if (/stream:\s*OK(?:\u0000|\n|$)/.test(reply)) {
        settled = true;
        socket.destroy();
        resolve("clean");
      } else if (/ERROR/.test(reply))
        fail(new Error("Malware scanner không hoàn thành kiểm tra."));
    });
    socket.on("close", () => {
      if (!settled)
        fail(new Error("ClamAV đóng kết nối trước khi xác nhận file sạch."));
    });
    socket.on("connect", async () => {
      try {
        await writeChunk(socket, Buffer.from("zINSTREAM\0"));
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
          const chunk = bytes.subarray(
            offset,
            Math.min(offset + 64 * 1024, bytes.length),
          );
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          await writeChunk(socket, Buffer.concat([size, chunk]));
        }
        await writeChunk(socket, Buffer.alloc(4));
      } catch {
        fail(new Error("Không truyền được file đến malware scanner."));
      }
    });
  });
}
