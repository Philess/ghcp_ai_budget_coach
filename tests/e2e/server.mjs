import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve('simulator');
const port = Number.parseInt(process.env.PORT || '4173', 10);
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
        const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const filePath = resolve(root, `.${relativePath}`);

        if (filePath !== root && !filePath.startsWith(root + sep)) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
            response.writeHead(404).end('Not found');
            return;
        }

        response.writeHead(200, {
            'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        createReadStream(filePath).pipe(response);
    } catch (error) {
        response.writeHead(error?.code === 'ENOENT' ? 404 : 500).end(
            error?.code === 'ENOENT' ? 'Not found' : 'Internal server error'
        );
    }
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Simulator server listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
