import net from "node:net";
export async function simulatedScanner(reply = "stream: OK\0") {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0);
    let command = false;
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (!command) {
        if (pending.length < 10) return;
        if (pending.subarray(0, 10).toString() !== "zINSTREAM\0") {
          socket.end("stream: ERROR\0");
          return;
        }
        pending = pending.subarray(10);
        command = true;
      }
      while (pending.length >= 4) {
        const size = pending.readUInt32BE(0);
        if (pending.length < size + 4) return;
        if (!size) {
          received.push(Buffer.concat(chunks));
          socket.end(reply);
          return;
        }
        chunks.push(pending.subarray(4, 4 + size));
        pending = pending.subarray(4 + size);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
