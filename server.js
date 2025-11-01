const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { problems, utils } = require('./scripts/problems.js');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_ROOT = path.join(__dirname);

const dotenv = require("dotenv");
dotenv.config();

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
const DATABASE_URL = process.env.DATABASE_URL
const BOARD_NAME_MAX_LENGTH = 80;
const BOARD_MESSAGE_MAX_LENGTH = 4000;
const BOARD_MESSAGE_LIMIT = 200;
const PROBLEM_ID_PATTERN = /^p?(\d+)$/i;

let pool = null;
if (DATABASE_URL) {
    const poolConfig = { connectionString: DATABASE_URL };
    const sslEnv = (process.env.DATABASE_SSL || process.env.PGSSLMODE || process.env.PGSSL || '').toLowerCase();
    const isLocalHost = /^postgres(?:ql)?:\/\/(?:localhost|127(?:\.\d{1,3}){3})(?::\d+)?\//i.test(DATABASE_URL);
    const shouldUseSsl = sslEnv === 'require'
        || sslEnv === 'true'
        || (!sslEnv && !isLocalHost);

    if (shouldUseSsl) {
        poolConfig.ssl = { rejectUnauthorized: false };
    } else if (sslEnv === 'disable' || sslEnv === 'false') {
        poolConfig.ssl = false;
    }

    pool = new Pool(poolConfig);
}

if (pool) {
    pool.on('error', (error) => {
        console.error('Unexpected database error', error);
    });
} else {
    console.warn('DATABASE_URL not set; problem board endpoint disabled.');
}

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
}

function resolveProblemIdentifier(rawId) {
    if (typeof rawId !== 'string') return null;
    const trimmed = rawId.trim();
    if (!trimmed) return null;
    const match = PROBLEM_ID_PATTERN.exec(trimmed);
    if (!match) return null;
    const canonicalId = `p${match[1]}`;
    if (!PROBLEM_MAP.has(canonicalId)) return null;
    return { canonicalId, numericId: match[1] };
}

function sanitizeBoardName(raw) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) return '匿名';
    return name.slice(0, BOARD_NAME_MAX_LENGTH);
}

function sanitizeBoardMessage(raw) {
    const message = typeof raw === 'string' ? raw.trim() : '';
    if (!message) return '';
    return message.slice(0, BOARD_MESSAGE_MAX_LENGTH);
}

function formatBoardRow(row, canonicalId) {
    const createdMs = row && row.created_at ? Date.parse(row.created_at) : NaN;
    return {
        id: row && row.id !== undefined && row.id !== null ? row.id.toString() : '',
        problemId: canonicalId,
        name: row && typeof row.name === 'string' && row.name.trim() ? row.name : '匿名',
        message: row && typeof row.chat === 'string' ? row.chat : '',
        createdAt: Number.isNaN(createdMs) ? Date.now() : createdMs,
    };
}

function generateBoardId() {
    const now = BigInt(Date.now());
    const random = BigInt(Math.floor(Math.random() * 1000));
    return (now * 1000n + random).toString();
}

function readJsonBody(req, limit = 1024 * 128) {
    return new Promise((resolve, reject) => {
        let body = '';
        let aborted = false;

        const cleanup = () => {
            req.removeListener('data', onData);
            req.removeListener('end', onEnd);
            req.removeListener('error', onError);
            req.removeListener('aborted', onAborted);
        };

        const onData = (chunk) => {
            if (aborted) return;
            body += chunk;
            if (body.length > limit) {
                aborted = true;
                cleanup();
                reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
            }
        };

        const onEnd = () => {
            if (aborted) return;
            cleanup();
            if (!body) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 }));
            }
        };

        const onError = (error) => {
            if (aborted) return;
            aborted = true;
            cleanup();
            reject(error);
        };

        const onAborted = () => {
            if (aborted) return;
            aborted = true;
            cleanup();
            reject(Object.assign(new Error('Request aborted'), { statusCode: 499 }));
        };

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
        req.on('aborted', onAborted);
    });
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

function handleBoardRoute(req, res, rawProblemId) {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return;
    }

    if (!pool) {
        sendJson(res, 503, { ok: false, message: '掲示板機能は未設定です。DATABASE_URL を設定してください。' });
        return;
    }

    const resolved = resolveProblemIdentifier(rawProblemId);
    if (!resolved) {
        sendJson(res, 404, { ok: false, message: 'Problem not found.' });
        return;
    }

    if (req.method === 'GET') {
        (async () => {
            try {
                const result = await pool.query(
                    `SELECT id, problem_id, name, chat, created_at
                     FROM problem_chat
                     WHERE problem_id = $1
                     ORDER BY created_at ASC, id ASC
                     LIMIT ${BOARD_MESSAGE_LIMIT}`,
                    [resolved.numericId],
                );
                const messages = Array.isArray(result.rows)
                    ? result.rows.map((row) => formatBoardRow(row, resolved.canonicalId))
                    : [];
                sendJson(res, 200, { ok: true, messages });
            } catch (error) {
                console.error('Failed to load board messages', error);
                sendJson(res, 500, { ok: false, message: 'Failed to load board messages.' });
            }
        })();
        return;
    }

    if (req.method === 'POST') {
        (async () => {
            try {
                const payload = await readJsonBody(req);
                const name = sanitizeBoardName(payload && payload.name);
                const message = sanitizeBoardMessage(
                    payload && (payload.message !== undefined ? payload.message : payload.chat),
                );
                if (!message) {
                    sendJson(res, 400, { ok: false, message: 'Message body is required.' });
                    return;
                }

                const entryId = generateBoardId();
                let insertedRow;
                try {
                    const insertResult = await pool.query(
                        `INSERT INTO problem_chat (id, problem_id, name, chat)
                         VALUES ($1, $2, $3, $4)
                         RETURNING id, problem_id, name, chat, created_at`,
                        [entryId, resolved.numericId, name, message],
                    );
                    insertedRow = insertResult.rows && insertResult.rows[0];
                } catch (error) {
                    if (error && error.code === '23505') {
                        const retryId = generateBoardId();
                        const retryResult = await pool.query(
                            `INSERT INTO problem_chat (id, problem_id, name, chat)
                             VALUES ($1, $2, $3, $4)
                             RETURNING id, problem_id, name, chat, created_at`,
                            [retryId, resolved.numericId, name, message],
                        );
                        insertedRow = retryResult.rows && retryResult.rows[0];
                    } else {
                        throw error;
                    }
                }

                if (!insertedRow) {
                    sendJson(res, 500, { ok: false, message: 'Failed to store message.' });
                    return;
                }

                const formatted = formatBoardRow(insertedRow, resolved.canonicalId);
                sendJson(res, 201, { ok: true, message: formatted });
            } catch (error) {
                if (error && typeof error.statusCode === 'number') {
                    sendJson(res, error.statusCode, { ok: false, message: error.message });
                    return;
                }
                console.error('Failed to post board message', error);
                sendJson(res, 500, { ok: false, message: 'Failed to post message.' });
            }
        })();
        return;
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
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
    const segments = parsedUrl.pathname.split('/').filter(Boolean);

    if (segments.length === 4 && segments[0] === 'api' && segments[1] === 'problems' && segments[3] === 'board') {
        handleBoardRoute(req, res, segments[2]);
        return;
    }

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
