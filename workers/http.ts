import { createServer, type RequestListener } from 'node:http';

// HTTP routing registrations belong to the isolate, while Durable Objects can
// be recreated within that isolate. Give each request its own temporary server
// and release the registration after dispatch instead of retaining a fixed port.
export async function serveHttpRequest(
  app: RequestListener,
  request: Request,
  dispatch: (port: number, request: Request) => Promise<Response>,
): Promise<Response> {
  const server = createServer((req, res) => {
    const address = req.headers['x-company-client-ip'];
    if (typeof address === 'string') Object.defineProperty(req.socket, 'remoteAddress', { value: address, configurable: true });
    delete req.headers['x-company-client-ip'];
    app(req, res);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP routing registration failed');
    return await dispatch(address.port, request);
  } finally {
    // close() stops accepting requests and lets the current response finish.
    server.close();
  }
}
