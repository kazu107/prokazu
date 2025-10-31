const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { problems, utils } = require('./scripts/problems.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_ROOT = path.join(__dirname);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const PROBLEM_MAP = new Map(problems.map((problem) => [problem.id, problem]));

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
}

function handleCheck(req, res) {
    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) {
            req.connection.destroy();
        }
    });
    req.on('end', () => {
        let payload;
        try {
            payload = body ? JSON.parse(body) : {};
        } catch (error) {
            sendJson(res, 400, { ok: false, message: 'Invalid JSON payload.' });
            return;
        }

        const { problemId, answers } = payload || {};
        if (typeof problemId !== 'string' || !problemId) {
            sendJson(res, 400, { ok: false, message: 'Missing problemId.' });
            return;
        }

        const problem = PROBLEM_MAP.get(problemId);
        if (!problem) {
            sendJson(res, 404, { ok: false, message: 'Problem not found.' });
            return;
        }

        try {
            const result = problem.check(typeof answers === 'object' && answers !== null ? answers : {}, utils) || {};
            const ok = Boolean(result.ok);
            const message = typeof result.message === 'string'
                ? result.message
                : ok ? 'Correct.' : 'Incorrect.';
            sendJson(res, 200, { ok, message });
        } catch (error) {
            console.error('Failed to evaluate answer', error);
            sendJson(res, 500, { ok: false, message: 'Internal error during evaluation.' });
        }
    });
}

function serveStatic(req, res, parsedUrl) {
    let pathname = decodeURIComponent(parsedUrl.pathname);
    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    }

    const filePath = path.join(STATIC_ROOT, pathname);
    if (!filePath.startsWith(STATIC_ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (statError, stats) => {
        if (statError) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        let finalPath = filePath;
        if (stats.isDirectory()) {
            finalPath = path.join(filePath, 'index.html');
        }

        fs.readFile(finalPath, (readError, data) => {
            if (readError) {
                res.writeHead(500);
                res.end('Internal Server Error');
                return;
            }

            const ext = path.extname(finalPath);
            const mime = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime });
            res.end(data);
        });
    });
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS' && parsedUrl.pathname === '/api/check') {
        res.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return;
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/api/check') {
        handleCheck(req, res);
        return;
    }

    if (req.method === 'GET') {
        serveStatic(req, res, parsedUrl);
        return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
});

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}/`);
});
