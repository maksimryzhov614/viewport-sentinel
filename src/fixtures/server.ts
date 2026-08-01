import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';

const routes = new Map([
  ['/clean', 'clean.html'],
  ['/overflow', 'overflow.html'],
  ['/overlap', 'overlap.html'],
  ['/picture', 'picture.html'],
  ['/console', 'console.html'],
  ['/timeout', 'timeout.html'],
  ['/assets/valid.svg', 'valid.svg'],
]);

export interface FixtureServer {
  readonly url: string;
  close(): Promise<void>;
}

function respondNotFound(response: ServerResponse): void {
  response.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end('Not found\n');
}

export async function startFixtureServer(port = 4173): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const fileName = routes.get(pathname);
    if (fileName === undefined) {
      respondNotFound(response);
      return;
    }

    void readFile(
      new URL(`../../fixtures/site/${fileName}`, import.meta.url),
    ).then(
      (content) => {
        const isHtml = fileName.endsWith('.html');
        response.writeHead(200, {
          'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'image/svg+xml',
          'Cache-Control': 'no-store',
        });
        response.end(content);
      },
      () => {
        response.writeHead(500, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('Fixture unavailable\n');
      },
    );
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      rejectListen(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolveListen();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose();
      });
    });
    throw new Error('Fixture server did not expose a TCP address');
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    async close(): Promise<void> {
      if (!server.listening) {
        return;
      }
      server.closeIdleConnections();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) {
            resolveClose();
          } else {
            rejectClose(error);
          }
        });
      });
    },
  };
}
