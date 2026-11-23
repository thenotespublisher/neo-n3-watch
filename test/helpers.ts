import http from "node:http";
import { AddressInfo } from "node:net";

export interface Received {
  method?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface TestServer {
  url: URL;
  received: Received[];
  close: () => Promise<void>;
}

export async function server(
  handler: (n: number, res: http.ServerResponse) => void
): Promise<TestServer> {
  const received: Received[] = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ method: req.method, headers: req.headers, body });
      handler(received.length, res);
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}/hook`),
    received,
    close: () =>
      new Promise<void>((resolve) => {
        srv.closeAllConnections();
        srv.close(() => resolve());
      }),
  };
}

export const status = (code: number) => (_n: number, res: http.ServerResponse) => {
  res.statusCode = code;
  res.end();
};
