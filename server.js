const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const { problems, utils, battleProblems } = require('./scripts/problems.js');
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
    '.index': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const PROBLEM_MAP = new Map(problems.map((problem) => [problem.id, problem]));
const DATABASE_URL = process.env.DATABASE_URL;
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
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
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

const BATTLE_PROBLEMS = Array.isArray(battleProblems)
    ? battleProblems.filter((problem) => problem && typeof problem.check === 'function')
    : [];
const BATTLE_GAMES = new Map();
const BATTLE_PLAYER_NAME_MAX = 24;
const BATTLE_MAX_PLAYERS = 24;
const BATTLE_MIN_ROUNDS = 1;
const BATTLE_MAX_ROUNDS = 20;
const BATTLE_MIN_ROUND_TIME = 10;
const BATTLE_MAX_ROUND_TIME = 600;
const BATTLE_MAX_PLACEMENTS = 8;
const BATTLE_GAME_TTL_MS = 1000 * 60 * 60 * 6;
const BATTLE_ROUND_DELAY_MS = 3000;
const BATTLE_DEFAULT_CONFIG = Object.freeze({
    rounds: 5,
    roundTimeSeconds: 60,
    placementPoints: [5, 3, 1],
    penalty: 1,
});

function nowMs() {
    return Date.now();
}

function randomToken(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function generateBattleId() {
    let id = '';
    while (id.length < 6) {
        id += Math.random().toString(36).slice(2).toUpperCase();
    }
    id = id.slice(0, 6);
    if (BATTLE_GAMES.has(id)) {
        return generateBattleId();
    }
    return id;
}

function sanitizePlayerName(raw, fallback) {
    const trimmed = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    const safe = trimmed ? trimmed.slice(0, BATTLE_PLAYER_NAME_MAX) : '';
    if (safe) return safe;
    return fallback;
}

function cloneInputs(inputs) {
    if (!Array.isArray(inputs)) return [];
    return inputs.map((inp) => ({ ...inp }));
}

function sanitizeBattleProblem(problem) {
    return {
        id: problem.id,
        baseId: problem.baseId || null,
        title: problem.title,
        statement: problem.statement,
        inputs: cloneInputs(problem.inputs),
        difficulty: problem.difficulty || null,
    };
}

function createBattleGame(id) {
    const now = nowMs();
    return {
        id,
        createdAt: now,
        updatedAt: now,
        state: 'waiting',
        hostToken: null,
        config: null,
        players: new Map(),
        nextPlayerIndex: 1,
        usedProblemIds: new Set(),
        round: null,
        history: [],
        timers: {
            round: null,
            advance: null,
        },
        finishedAt: null,
    };
}

function stopBattleTimer(game, key) {
    if (game.timers && game.timers[key]) {
        clearTimeout(game.timers[key]);
        game.timers[key] = null;
    }
}

function clearBattleTimers(game) {
    stopBattleTimer(game, 'round');
    stopBattleTimer(game, 'advance');
}

function cleanupBattleGames() {
    const now = nowMs();
    for (const [id, game] of BATTLE_GAMES) {
        const inactiveMs = now - game.updatedAt;
        if (!game.players.size && inactiveMs > 30 * 60 * 1000) {
            clearBattleTimers(game);
            BATTLE_GAMES.delete(id);
            continue;
        }
        if (inactiveMs > BATTLE_GAME_TTL_MS) {
            clearBattleTimers(game);
            BATTLE_GAMES.delete(id);
        }
    }
}

function findQuickJoinRoom() {
    let candidate = null;
    for (const game of BATTLE_GAMES.values()) {
        if (game.state !== 'waiting') continue;
        if (!game.players.size) continue;
        if (game.players.size >= BATTLE_MAX_PLAYERS) continue;
        if (!candidate || game.createdAt < candidate.createdAt) {
            candidate = game;
        }
    }
    return candidate;
}

function pickBattleProblem(game) {
    if (!BATTLE_PROBLEMS.length) return null;
    const available = BATTLE_PROBLEMS.filter((problem) => !game.usedProblemIds.has(problem.id));
    const pool = available.length ? available : BATTLE_PROBLEMS;
    if (!available.length) {
        game.usedProblemIds.clear();
    }
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    game.usedProblemIds.add(chosen.id);
    return chosen;
}

function getBattlePlayerByToken(game, token) {
    if (!token) return null;
    return game.players.get(token) || null;
}

function removeBattlePlayer(game, token) {
    const player = game.players.get(token);
    if (!player) return false;
    game.players.delete(token);
    if (token === game.hostToken) {
        const nextHost = Array.from(game.players.values())
            .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
        game.hostToken = nextHost ? nextHost.token : null;
    }
    if (!game.players.size) {
        clearBattleTimers(game);
    }
    game.updatedAt = nowMs();
    return true;
}

function getLeaderboard(game) {
    return Array.from(game.players.values()).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
}

function parsePlacementPoints(raw) {
    if (Array.isArray(raw)) {
        return raw
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.min(Math.round(value), 100))
            .slice(0, BATTLE_MAX_PLACEMENTS);
    }
    if (typeof raw === 'string') {
        return raw
            .split(/[, \t\r\n]+/)
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.min(Math.round(value), 100))
            .slice(0, BATTLE_MAX_PLACEMENTS);
    }
    return [];
}

function normalizeBattleConfig(input) {
    if (!input || typeof input !== 'object') {
        return { ok: false, message: 'Invalid configuration payload.' };
    }
    const roundsRaw = Number.isFinite(Number(input.rounds))
        ? Number(input.rounds)
        : Number.isFinite(Number(input.roundCount)) ? Number(input.roundCount) : NaN;
    const roundTimeRaw = Number.isFinite(Number(input.roundTimeSeconds))
        ? Number(input.roundTimeSeconds)
        : Number.isFinite(Number(input.roundTime)) ? Number(input.roundTime) : NaN;
    const penaltyRaw = Number.isFinite(Number(input.penalty))
        ? Number(input.penalty)
        : Number.isFinite(Number(input.wrongPenalty)) ? Number(input.wrongPenalty) : NaN;
    const placementPoints = parsePlacementPoints(
        input.placementPoints !== undefined ? input.placementPoints : input.scoring || input.pointsPerRank,
    );

    const rounds = Number.isFinite(roundsRaw)
        ? Math.min(Math.max(Math.floor(roundsRaw), BATTLE_MIN_ROUNDS), BATTLE_MAX_ROUNDS)
        : BATTLE_DEFAULT_CONFIG.rounds;
    const roundTimeSeconds = Number.isFinite(roundTimeRaw)
        ? Math.min(Math.max(Math.floor(roundTimeRaw), BATTLE_MIN_ROUND_TIME), BATTLE_MAX_ROUND_TIME)
        : BATTLE_DEFAULT_CONFIG.roundTimeSeconds;
    let penalty = Number.isFinite(penaltyRaw)
        ? Math.min(Math.max(Math.round(Math.abs(penaltyRaw)), 0), 50)
        : BATTLE_DEFAULT_CONFIG.penalty;
    let points = placementPoints;
    if (!points.length) {
        points = [...BATTLE_DEFAULT_CONFIG.placementPoints];
    }

    return {
        ok: true,
        config: {
            rounds,
            roundTimeSeconds,
            placementPoints: points,
            penalty,
        },
    };
}

function serializeBattleRound(game, viewerToken) {
    const round = game.round;
    if (!round) return null;
    const now = nowMs();
    const timeRemaining = round.status === 'active'
        ? Math.max(0, Math.ceil((round.endsAt - now) / 1000))
        : 0;
    const myAttempts = viewerToken
        ? round.attempts
            .filter((attempt) => attempt.playerToken === viewerToken)
            .map((attempt) => ({
                submittedAt: attempt.submittedAt,
                correct: Boolean(attempt.correct),
                placement: attempt.placement || null,
                awarded: attempt.awarded || 0,
                penalty: attempt.penalty || 0,
            }))
        : [];
    return {
        index: round.index,
        status: round.status,
        startedAt: round.startedAt,
        endsAt: round.endsAt,
        timeRemaining,
        maxAwards: game.config ? game.config.placementPoints.length : 0,
        awardsTaken: round.correct.length,
        problem: round.problemPublic,
        correct: round.correct.map((entry) => ({
            playerId: entry.playerId,
            name: entry.name,
            placement: entry.placement,
            awarded: entry.awarded,
            answeredAt: entry.answeredAt,
            timeTakenMs: entry.timeTakenMs,
        })),
        myAttempts,
        finishReason: round.finishReason || null,
        nextStartAt: round.nextStartAt || null,
    };
}

function serializeGameForPlayer(game, viewerToken) {
    const now = nowMs();
    const me = viewerToken ? game.players.get(viewerToken) : null;
    if (me) {
        me.lastSeenAt = now;
    }
    game.updatedAt = now;

    const leaderboard = getLeaderboard(game);
    const hostPlayer = game.hostToken ? game.players.get(game.hostToken) : null;
    return {
        id: game.id,
        state: game.state,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
        config: game.config ? {
            rounds: game.config.rounds,
            roundTimeSeconds: game.config.roundTimeSeconds,
            placementPoints: [...game.config.placementPoints],
            penalty: game.config.penalty,
        } : null,
        defaultConfig: { ...BATTLE_DEFAULT_CONFIG },
        players: leaderboard.map((player) => ({
            id: player.id,
            name: player.name,
            score: player.score,
            isHost: player.token === game.hostToken,
            joinedAt: player.joinedAt,
        })),
        me: me ? {
            id: me.id,
            name: me.name,
            score: me.score,
            isHost: me.token === game.hostToken,
        } : null,
        hostPlayerId: hostPlayer ? hostPlayer.id : null,
        round: serializeBattleRound(game, viewerToken),
        history: game.history.slice(-10),
        totals: {
            roundsCompleted: game.history.length,
            roundsPlanned: game.config ? game.config.rounds : 0,
        },
        results: game.state === 'results'
            ? leaderboard.map((player, index) => ({
                rank: index + 1,
                id: player.id,
                name: player.name,
                score: player.score,
            }))
            : null,
        settingsLocked: game.state === 'active',
        battleProblemCount: BATTLE_PROBLEMS.length,
    };
}

function beginBattleRound(game) {
    stopBattleTimer(game, 'advance');
    if (!game.config) {
        return false;
    }
    if (!BATTLE_PROBLEMS.length) {
        game.state = 'results';
        game.finishedAt = nowMs();
        game.round = null;
        return false;
    }
    if (game.history.length >= game.config.rounds) {
        game.state = 'results';
        game.finishedAt = nowMs();
        game.round = null;
        return false;
    }
    const problem = pickBattleProblem(game);
    if (!problem) {
        game.state = 'results';
        game.finishedAt = nowMs();
        game.round = null;
        return false;
    }
    const now = nowMs();
    const round = {
        index: game.history.length + 1,
        status: 'active',
        startedAt: now,
        endsAt: now + game.config.roundTimeSeconds * 1000,
        problemId: problem.id,
        problemData: problem,
        problemPublic: sanitizeBattleProblem(problem),
        attempts: [],
        correct: [],
        finishReason: null,
        nextStartAt: null,
    };
    game.round = round;
    game.state = 'active';
    game.updatedAt = now;

    stopBattleTimer(game, 'round');
    game.timers.round = setTimeout(() => {
        finishBattleRound(game, 'time');
    }, game.config.roundTimeSeconds * 1000);
    return true;
}

function finishBattleRound(game, reason) {
    const round = game.round;
    if (!round || round.status !== 'active') return;

    round.status = 'finished';
    round.finishReason = reason || null;
    round.finishedAt = nowMs();
    stopBattleTimer(game, 'round');

    const summary = {
        index: round.index,
        problemId: round.problemId,
        title: round.problemPublic.title,
        winners: round.correct.map((entry) => ({
            playerId: entry.playerId,
            name: entry.name,
            placement: entry.placement,
            awarded: entry.awarded,
            timeTakenMs: entry.timeTakenMs,
        })),
        startedAt: round.startedAt,
        finishedAt: round.finishedAt,
        reason: round.finishReason,
    };
    game.history.push(summary);
    game.updatedAt = round.finishedAt;

    if (!game.config || game.history.length >= game.config.rounds) {
        game.state = 'results';
        game.finishedAt = round.finishedAt;
        round.nextStartAt = null;
        stopBattleTimer(game, 'advance');
        return;
    }

    round.nextStartAt = round.finishedAt + BATTLE_ROUND_DELAY_MS;
    stopBattleTimer(game, 'advance');
    game.timers.advance = setTimeout(() => {
        beginBattleRound(game);
    }, BATTLE_ROUND_DELAY_MS);
}

function attemptBattleAnswer(game, player, answers) {
    const round = game.round;
    if (!round || round.status !== 'active') {
        return { ok: false, message: 'Round is not active.' };
    }
    const now = nowMs();
    const limit = Math.max(1, game.config ? game.config.placementPoints.length : 1);

    const alreadySolved = round.correct.find((entry) => entry.playerId === player.id);
    if (alreadySolved) {
        return {
            ok: true,
            correct: true,
            alreadySolved: true,
            placement: alreadySolved.placement,
            awarded: 0,
            score: player.score,
        };
    }

    let isCorrect = false;
    try {
        const evaluation = round.problemData.check(
            typeof answers === 'object' && answers !== null ? answers : {},
            utils,
        ) || {};
        isCorrect = Boolean(evaluation.ok);
    } catch (error) {
        console.error('Failed to evaluate battle answer', error);
    }

    const attemptRecord = {
        playerToken: player.token,
        playerId: player.id,
        submittedAt: now,
        correct: isCorrect,
    };
    round.attempts.push(attemptRecord);

    player.lastSeenAt = now;
    game.updatedAt = now;

    if (isCorrect) {
        const placementIndex = round.correct.length;
        if (placementIndex >= limit) {
            return {
                ok: false,
                message: 'Round already resolved.',
                correct: false,
                score: player.score,
            };
        }

        const placement = placementIndex + 1;
        const awarded = placementIndex < game.config.placementPoints.length
            ? game.config.placementPoints[placementIndex]
            : 0;
        if (awarded > 0) {
            player.score += awarded;
        }
        player.stats = player.stats || { correct: 0, incorrect: 0 };
        player.stats.correct += 1;

        const correctEntry = {
            playerId: player.id,
            name: player.name,
            placement,
            awarded,
            answeredAt: now,
            timeTakenMs: now - round.startedAt,
        };
        round.correct.push(correctEntry);

        attemptRecord.placement = placement;
        attemptRecord.awarded = awarded;

        if (round.correct.length >= limit) {
            finishBattleRound(game, 'max_correct');
        }

        return {
            ok: true,
            correct: true,
            placement,
            awarded,
            score: player.score,
        };
    }

    const penalty = Math.max(0, Number(game.config ? game.config.penalty : 0));
    let appliedPenalty = 0;
    if (penalty > 0) {
        player.score -= penalty;
        appliedPenalty = penalty;
        attemptRecord.penalty = penalty;
    }
    player.stats = player.stats || { correct: 0, incorrect: 0 };
    player.stats.incorrect += 1;

    return {
        ok: true,
        correct: false,
        penaltyApplied: appliedPenalty > 0,
        penalty: appliedPenalty,
        score: player.score,
    };
}

async function handleBattleJoinRequest(req, res) {
    try {
        const payload = await readJsonBody(req);
        cleanupBattleGames();

        let { roomId, room, name, playerName, token: existingToken, playerToken } = payload || {};
        let desiredId = typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
        if (!desiredId && typeof room === 'string') {
            desiredId = room.trim().toUpperCase();
        }
        if (desiredId && !/^[A-Z0-9-]{4,12}$/.test(desiredId)) {
            sendJson(res, 400, { ok: false, message: 'Room ID must be 4-12 alphanumeric characters.' });
            return;
        }
        if (!desiredId) {
            desiredId = generateBattleId();
        }

        let game = BATTLE_GAMES.get(desiredId);
        if (!game) {
            game = createBattleGame(desiredId);
            BATTLE_GAMES.set(desiredId, game);
        }

        const now = nowMs();
        const reconnectToken = typeof (playerToken || existingToken) === 'string'
            ? (playerToken || existingToken).trim()
            : '';

        if (reconnectToken) {
            const existing = getBattlePlayerByToken(game, reconnectToken);
            if (existing) {
                existing.name = sanitizePlayerName(name || playerName, existing.name);
                existing.lastSeenAt = now;
                const gameState = serializeGameForPlayer(game, existing.token);
                sendJson(res, 200, {
                    ok: true,
                    roomId: game.id,
                    playerToken: existing.token,
                    game: gameState,
                    rejoined: true,
                });
                return;
            }
        }

        if (game.players.size >= BATTLE_MAX_PLAYERS) {
            sendJson(res, 403, { ok: false, message: 'This room is full.' });
            return;
        }

        const token = randomToken('player');
        const playerIndex = game.nextPlayerIndex || 1;
        game.nextPlayerIndex = playerIndex + 1;
        const fallbackName = `Player ${playerIndex}`;
        const player = {
            id: `P${String(playerIndex).padStart(2, '0')}`,
            token,
            name: sanitizePlayerName(name || playerName, fallbackName),
            score: 0,
            joinedAt: now,
            lastSeenAt: now,
            stats: { correct: 0, incorrect: 0 },
        };

        if (!game.hostToken) {
            game.hostToken = token;
        }

        game.players.set(token, player);
        game.updatedAt = now;

        const gameState = serializeGameForPlayer(game, token);
        sendJson(res, 200, {
            ok: true,
            roomId: game.id,
            playerToken: token,
            game: gameState,
            rejoined: false,
        });
    } catch (error) {
        console.error('Failed to process battle join request', error);
        sendJson(res, 500, { ok: false, message: 'Failed to join battle room.' });
    }
}

async function handleBattleConfigRequest(req, res, roomId) {
    const game = BATTLE_GAMES.get(roomId);
    if (!game) {
        sendJson(res, 404, { ok: false, message: 'Room not found.' });
        return;
    }
    try {
        const payload = await readJsonBody(req);
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        if (!token) {
            sendJson(res, 401, { ok: false, message: 'Missing player token.' });
            return;
        }
        if (token !== game.hostToken) {
            sendJson(res, 403, { ok: false, message: 'Only the host can update settings.' });
            return;
        }

        const { ok, config, message } = normalizeBattleConfig(payload.config || payload);
        if (!ok) {
            sendJson(res, 400, { ok: false, message: message || 'Invalid configuration.' });
            return;
        }

        game.config = config;
        game.updatedAt = nowMs();

        const state = serializeGameForPlayer(game, token);
        sendJson(res, 200, { ok: true, config, game: state });
    } catch (error) {
        console.error('Failed to update battle configuration', error);
        sendJson(res, 500, { ok: false, message: 'Failed to update configuration.' });
    }
}

async function handleBattleStartRequest(req, res, roomId) {
    const game = BATTLE_GAMES.get(roomId);
    if (!game) {
        sendJson(res, 404, { ok: false, message: 'Room not found.' });
        return;
    }

    try {
        const payload = await readJsonBody(req);
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        if (!token) {
            sendJson(res, 401, { ok: false, message: 'Missing player token.' });
            return;
        }
        if (token !== game.hostToken) {
            sendJson(res, 403, { ok: false, message: 'Only the host can start the game.' });
            return;
        }
        if (!game.players.size) {
            sendJson(res, 400, { ok: false, message: 'At least one player is required to start.' });
            return;
        }
        if (game.state === 'active') {
            sendJson(res, 409, { ok: false, message: 'Game already started.' });
            return;
        }
        if (!game.config) {
            game.config = { ...BATTLE_DEFAULT_CONFIG };
        }

        game.history = [];
        game.usedProblemIds.clear();
        game.finishedAt = null;
        for (const player of game.players.values()) {
            player.score = 0;
            player.stats = { correct: 0, incorrect: 0 };
        }
        game.state = 'waiting';
        game.round = null;

        const started = beginBattleRound(game);
        if (!started) {
            sendJson(res, 500, { ok: false, message: 'Failed to start the first round.' });
            return;
        }

        const state = serializeGameForPlayer(game, token);
        sendJson(res, 200, { ok: true, game: state });
    } catch (error) {
        console.error('Failed to start battle game', error);
        sendJson(res, 500, { ok: false, message: 'Failed to start game.' });
    }
}

async function handleBattleAnswerRequest(req, res, roomId) {
    const game = BATTLE_GAMES.get(roomId);
    if (!game) {
        sendJson(res, 404, { ok: false, message: 'Room not found.' });
        return;
    }
    try {
        const payload = await readJsonBody(req);
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        if (!token) {
            sendJson(res, 401, { ok: false, message: 'Missing player token.' });
            return;
        }
        const player = getBattlePlayerByToken(game, token);
        if (!player) {
            sendJson(res, 404, { ok: false, message: 'Player not found in this room.' });
            return;
        }
        if (game.state !== 'active') {
            sendJson(res, 409, { ok: false, message: 'Game is not active.' });
            return;
        }
        if (!game.round || game.round.status !== 'active') {
            sendJson(res, 409, { ok: false, message: 'Round is not active.' });
            return;
        }

        const result = attemptBattleAnswer(game, player, payload.answers || payload.answer || {});
        const state = serializeGameForPlayer(game, token);
        sendJson(res, 200, { ...result, game: state });
    } catch (error) {
        console.error('Failed to process battle answer', error);
        sendJson(res, 500, { ok: false, message: 'Failed to submit answer.' });
    }
}

async function handleBattleLeaveRequest(req, res, roomId) {
    const game = BATTLE_GAMES.get(roomId);
    if (!game) {
        sendJson(res, 404, { ok: false, message: 'Room not found.' });
        return;
    }
    try {
        const payload = await readJsonBody(req);
        const token = typeof payload.token === 'string' ? payload.token.trim() : '';
        if (!token) {
            sendJson(res, 400, { ok: false, message: 'Missing player token.' });
            return;
        }
        removeBattlePlayer(game, token);
        const state = serializeGameForPlayer(game, null);
        sendJson(res, 200, { ok: true, game: state });
    } catch (error) {
        console.error('Failed to process battle leave', error);
        sendJson(res, 500, { ok: false, message: 'Failed to leave room.' });
    }
}

function handleBattleStateRequest(req, res, roomId, parsedUrl) {
    const game = BATTLE_GAMES.get(roomId);
    if (!game) {
        sendJson(res, 404, { ok: false, message: 'Room not found.' });
        return;
    }
    const token = parsedUrl.searchParams.get('token') || '';
    const state = serializeGameForPlayer(game, token.trim() || null);
    sendJson(res, 200, { ok: true, roomId: game.id, game: state });
}

function handleBattleApi(req, res, segments, parsedUrl) {
    cleanupBattleGames();

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return;
    }

    if (segments.length === 2 && segments[0] === 'rooms' && segments[1] === 'join') {
        if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
            return;
        }
        handleBattleJoinRequest(req, res);
        return;
    }

    if (segments.length === 2 && segments[0] === 'rooms' && segments[1] === 'quick') {
        if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
            return;
        }
        const available = findQuickJoinRoom();
        if (!available) {
            sendJson(res, 404, { ok: false, message: 'No available rooms.' });
            return;
        }
        sendJson(res, 200, {
            ok: true,
            roomId: available.id,
            playerCount: available.players.size,
        });
        return;
    }

    if (segments.length >= 2 && segments[0] === 'rooms') {
        const roomId = (segments[1] || '').trim().toUpperCase();
        const action = segments[2] || 'state';

        if (action === 'state' || (action === '' && req.method === 'GET')) {
            if (req.method !== 'GET') {
                sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
                return;
            }
            handleBattleStateRequest(req, res, roomId, parsedUrl);
            return;
        }
        if (action === 'config') {
            if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
                return;
            }
            handleBattleConfigRequest(req, res, roomId);
            return;
        }
        if (action === 'start') {
            if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
                return;
            }
            handleBattleStartRequest(req, res, roomId);
            return;
        }
        if (action === 'answer') {
            if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
                return;
            }
            handleBattleAnswerRequest(req, res, roomId);
            return;
        }
        if (action === 'leave') {
            if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
                return;
            }
            handleBattleLeaveRequest(req, res, roomId);
            return;
        }
    }

    sendJson(res, 404, { ok: false, message: 'Not Found' });
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

    if (segments.length >= 2 && segments[0] === 'api' && segments[1] === 'battle') {
        handleBattleApi(req, res, segments.slice(2), parsedUrl);
        return;
    }

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
