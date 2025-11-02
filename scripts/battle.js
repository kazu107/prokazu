(function () {
    'use strict';

    const API_ROOT = '/api/battle';
    const POLL_INTERVAL_MS = 2000;
    const TIMER_INTERVAL_MS = 250;
    const STORAGE_KEY = 'battle.session';
    const FEEDBACK_TIMEOUT_MS = 4500;

    const $ = (selector) => document.querySelector(selector);

    const lobbyEl = $('#battleLobby');
    const roomBadgeEl = $('#battleRoomBadge');
    const roundBadgeEl = $('#battleRoundBadge');
    const stateBadgeEl = $('#battleStateBadge');
    const timerEl = $('#battleTimer');
    const problemTitleEl = $('#battleProblemTitle');
    const problemStatementEl = $('#battleProblemStatement');
    const answerFormEl = $('#battleAnswerForm');
    const feedbackEl = $('#battleFeedback');
    const summaryEl = $('#battleRoundSummary');
    const resetBtn = $('#battleResetBtn');

    const state = {
        roomId: null,
        token: null,
        game: null,
        joining: false,
    };

    const drafts = {
        join: { name: '', room: '' },
        config: null,
    };

    let pollHandle = null;
    let timerHandle = null;
    let countdownTarget = null;
    let countdownMode = 'idle';
    let feedbackTimer = null;
    let lastRenderedProblemKey = null;

    function loadSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.roomId && parsed.playerToken) {
                return parsed;
            }
        } catch (error) {
            console.warn('Failed to load battle session', error);
        }
        return null;
    }

    function persistSession() {
        if (!state.roomId || !state.token) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                roomId: state.roomId,
                playerToken: state.token,
            }));
        } catch (error) {
            console.warn('Failed to persist battle session', error);
        }
    }

    function clearSession() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            console.warn('Failed to clear battle session', error);
        }
    }

    async function apiRequest(path, options = {}) {
        const init = {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
            ...options,
        };
        if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
            init.headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(init.body);
        }
        const response = await fetch(path, init);
        const text = await response.text();
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch (error) {
                console.warn('Failed to parse JSON response', error);
            }
        }
        if (!response.ok) {
            const message = payload && payload.message ? payload.message : `Request failed (${response.status})`;
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    function setFeedback(message, tone) {
        if (!feedbackEl) return;
        if (feedbackTimer) {
            clearTimeout(feedbackTimer);
            feedbackTimer = null;
        }
        if (!message) {
            feedbackEl.style.display = 'none';
            feedbackEl.textContent = '';
            feedbackEl.className = 'status';
            return;
        }
        feedbackEl.style.display = '';
        feedbackEl.textContent = message;
        feedbackEl.className = `status ${tone || ''}`.trim();
        feedbackTimer = window.setTimeout(() => {
            feedbackEl.style.display = 'none';
            feedbackEl.textContent = '';
            feedbackEl.className = 'status';
            feedbackTimer = null;
        }, FEEDBACK_TIMEOUT_MS);
    }

    function stopPolling() {
        if (pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
        }
    }

    function startPolling() {
        stopPolling();
        pollHandle = setInterval(() => {
            if (!state.roomId) return;
            fetchState().catch((error) => {
                console.warn('Polling failed', error);
            });
        }, POLL_INTERVAL_MS);
    }

    function stopTimer() {
        if (timerHandle) {
            clearInterval(timerHandle);
            timerHandle = null;
        }
    }

    function formatDuration(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return '00:00';
        const totalSeconds = Math.ceil(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateTimerDisplay() {
        if (!timerEl || !countdownTarget) {
            if (timerEl) timerEl.textContent = '';
            return;
        }
        const remainingMs = countdownTarget - Date.now();
        if (remainingMs <= 0) {
            timerEl.textContent = '';
            stopTimer();
            return;
        }
        const label = countdownMode === 'next'
            ? '次のラウンド開始まで: '
            : countdownMode === 'round'
                ? '残り時間: '
                : '';
        timerEl.textContent = `${label}${formatDuration(remainingMs)}`;
    }

    function configureTimer(game) {
        stopTimer();
        countdownTarget = null;
        countdownMode = 'idle';
        if (!game || !timerEl) {
            if (timerEl) timerEl.textContent = '';
            return;
        }
        const round = game.round;
        if (round && round.status === 'active') {
            countdownTarget = round.endsAt;
            countdownMode = 'round';
        } else if (round && round.status === 'finished' && round.nextStartAt) {
            countdownTarget = round.nextStartAt;
            countdownMode = 'next';
        } else {
            timerEl.textContent = '';
            return;
        }
        if (countdownTarget) {
            updateTimerDisplay();
            timerHandle = setInterval(updateTimerDisplay, TIMER_INTERVAL_MS);
        }
    }

    function renderJoinForm() {
        if (!lobbyEl) return;
        const existingForm = document.getElementById('battleJoinForm');
        let draftValues = null;
        let draftActiveId = null;
        let draftSelection = null;
        if (existingForm) {
            const formData = new FormData(existingForm);
            draftValues = {};
            formData.forEach((value, key) => {
                draftValues[key] = value;
            });
            const activeEl = document.activeElement;
            if (activeEl && existingForm.contains(activeEl) && activeEl.id) {
                draftActiveId = activeEl.id;
                if (typeof activeEl.selectionStart === 'number' && typeof activeEl.selectionEnd === 'number') {
                    draftSelection = {
                        start: activeEl.selectionStart,
                        end: activeEl.selectionEnd,
                    };
                }
            }
        }

        const defaultRoom = state.roomId || (readQueryParam('room') || '').toUpperCase();
        if (draftValues) {
            drafts.join.name = draftValues.name ?? drafts.join.name;
            drafts.join.room = draftValues.room ?? drafts.join.room;
        }
        if (!drafts.join.room && defaultRoom) {
            drafts.join.room = defaultRoom;
        }

        const nameValue = drafts.join.name || '';
        const roomValue = drafts.join.room || defaultRoom || '';
        const joinLabel = state.joining ? '参加中…' : 'ルームに参加';
        const joinDisabledAttr = state.joining ? 'disabled' : '';
        const quickDisabledAttr = state.joining ? 'disabled' : '';
        const escapeAttr = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        lobbyEl.innerHTML = `
            <form id="battleJoinForm" class="battle-join-form">
                <label class="battle-label" for="battleJoinName">プレイヤー名</label>
                <input id="battleJoinName" name="name" type="text" maxlength="24" placeholder="例: Alice" value="${escapeAttr(nameValue)}" required />

                <label class="battle-label" for="battleJoinRoom">ルームID (任意)</label>
                <input id="battleJoinRoom" name="room" type="text" maxlength="12" placeholder="空欄で新規作成" value="${escapeAttr(roomValue)}" />

                <div class="battle-join-actions">
                    <button type="submit" class="primary battle-join-button" ${joinDisabledAttr}>${joinLabel}</button>
                    <button type="button" id="battleQuickJoinBtn" class="ghost small" ${quickDisabledAttr}>クイック参加</button>
                </div>
                <p class="battle-help-text">ルームIDを空にすると新しいルームを作成します。クイック参加は待機中のルームを自動で探します。</p>
            </form>
        `;
        const joinForm = document.getElementById('battleJoinForm');
        if (joinForm) {
            joinForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (state.joining) return;
                const formData = new FormData(joinForm);
                const name = String(formData.get('name') || '').trim();
                const room = String(formData.get('room') || '').trim().toUpperCase();
                if (!name) {
                    setFeedback('プレイヤー名を入力してください。', 'warn');
                    return;
                }
                    await joinRoom({ name, roomId: room || undefined });
            });
        }
        const quickBtn = document.getElementById('battleQuickJoinBtn');
        if (quickBtn) {
            quickBtn.addEventListener('click', async () => {
                if (state.joining) return;
                const nameField = document.getElementById('battleJoinName');
                const nameValue = (nameField?.value || '').trim();
                if (!nameValue) {
                    setFeedback('プレイヤー名を入力してください。', 'warn');
                    nameField?.focus();
                    return;
                }
                try {
                    const result = await apiRequest(`${API_ROOT}/rooms/quick`, { method: 'POST' });
                    if (!result || !result.roomId) {
                        setFeedback(result?.message || '参加できるルームが見つかりませんでした。', 'warn');
                        return;
                    }
                    await joinRoom({ name: nameValue, roomId: result.roomId });
                } catch (error) {
                    console.error('Quick join failed', error);
                    setFeedback(error.message || 'クイック参加に失敗しました。', 'bad');
                }
            });
        }
        if (draftActiveId) {
            const focusTarget = document.getElementById(draftActiveId);
            if (focusTarget && typeof focusTarget.focus === 'function') {
                focusTarget.focus({ preventScroll: true });
                if (draftSelection && typeof focusTarget.setSelectionRange === 'function') {
                    try {
                        focusTarget.setSelectionRange(draftSelection.start, draftSelection.end);
                    } catch (error) {
                        const length = focusTarget.value.length;
                        focusTarget.setSelectionRange(length, length);
                    }
                }
            }
        }
        const nameField = document.getElementById('battleJoinName');
        if (nameField) {
            nameField.addEventListener('input', (event) => {
                drafts.join.name = event.target.value;
            });
        }
        const roomField = document.getElementById('battleJoinRoom');
        if (roomField) {
            roomField.addEventListener('input', (event) => {
                drafts.join.room = event.target.value;
            });
        }
    }

    function buildScoreboard(players, meId) {
        if (!Array.isArray(players) || !players.length) {
            return '<p class="battle-placeholder">プレイヤーはまだ参加していません。</p>';
        }
        const rows = players.map((player, index) => {
            const isMe = player.id === meId;
            const rank = index + 1;
            return `
                <tr class="${isMe ? 'battle-row-me' : ''}">
                    <td class="battle-cell-rank">${rank}</td>
                    <td>${player.name || 'Player'}</td>
                    <td>${player.score}</td>
                    <td>${player.isHost ? 'ホスト' : ''}</td>
                </tr>
            `;
        }).join('');
        return `
            <table class="battle-scoreboard">
                <thead>
                    <tr>
                        <th>順位</th>
                        <th>プレイヤー</th>
                        <th>得点</th>
                        <th>役割</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    function buildHistory(history) {
        if (!Array.isArray(history) || !history.length) {
            return '<p class="battle-placeholder">まだ結果はありません。</p>';
        }
        const items = history.slice(-5).reverse().map((round) => {
            const winners = (round.winners || [])
                .map((winner) => `${winner.placement}位: ${winner.name} (+${winner.awarded})`)
                .join(' / ') || '該当なし';
            const reason = round.reason === 'time'
                ? '時間切れ'
                : round.reason === 'max_correct'
                    ? '規定人数が正解'
                    : '完了';
            return `
                <li>
                    <div><strong>ラウンド ${round.index}</strong> (${reason})</div>
                    <div class="battle-history-winners">${winners}</div>
                </li>
            `;
        }).join('');
        return `<ol class="battle-history">${items}</ol>`;
    }

    function ensureConfigDraft(game) {
        if (!game) return null;
        const base = game.config || game.defaultConfig || {};
        const baseValues = {
            rounds: String(base.rounds ?? 5),
            roundTimeSeconds: String(base.roundTimeSeconds ?? 60),
            placementPoints: String((base.placementPoints || []).join(', ')),
            penalty: String(base.penalty ?? 1),
        };
        if (!drafts.config || drafts.config.roomId !== game.id) {
            drafts.config = {
                roomId: game.id,
                values: { ...baseValues },
                dirty: false,
                focusId: null,
                focusSelection: null,
            };
        } else if (!drafts.config.dirty) {
            drafts.config.values = { ...baseValues };
            if (typeof drafts.config.focusId === 'undefined') {
                drafts.config.focusId = null;
                drafts.config.focusSelection = null;
            }
        } else if (typeof drafts.config.focusId === 'undefined') {
            drafts.config.focusId = null;
            drafts.config.focusSelection = null;
        }
        return drafts.config;
    }

    function renderConfigSection(game) {
        const container = document.getElementById('battleConfigSection');
        if (!container || !game) return;
        const isHost = Boolean(game.me?.isHost);
        if (!isHost || game.settingsLocked) {
            const config = game.config || game.defaultConfig || {};
            const points = (config.placementPoints || []).join(', ');
            container.innerHTML = `
                <div class="battle-config-readonly">
                    <div><strong>ラウンド数:</strong> ${config.rounds ?? '-'}</div>
                    <div><strong>ラウンド制限時間:</strong> ${config.roundTimeSeconds ?? '-'} 秒</div>
                    <div><strong>得点配分:</strong> ${points || '-'}</div>
                    <div><strong>誤答ペナルティ:</strong> -${config.penalty ?? '-'} 点</div>
                    ${game.settingsLocked ? '<div class="battle-note">ゲーム進行中のため設定は変更できません。</div>' : ''}
                </div>
            `;
            return;
        }

        const draft = ensureConfigDraft(game);
        const values = draft ? draft.values : {
            rounds: '5',
            roundTimeSeconds: '60',
            placementPoints: '',
            penalty: '1',
        };
        const escapeAttr = (value) => String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        container.innerHTML = `
            <form id="battleConfigForm" class="battle-config-form">
                <label class="battle-label">ラウンド数
                    <input name="rounds" type="number" min="1" max="20" value="${escapeAttr(values.rounds)}" required />
                </label>
                <label class="battle-label">ラウンド制限時間 (秒)
                    <input name="roundTimeSeconds" type="number" min="10" max="600" value="${escapeAttr(values.roundTimeSeconds)}" required />
                </label>
                <label class="battle-label">得点配分 (例: 5,3,1)
                    <input name="placementPoints" type="text" value="${escapeAttr(values.placementPoints)}" />
                </label>
                <label class="battle-label">誤答ペナルティ (点)
                    <input name="penalty" type="number" min="0" max="50" value="${escapeAttr(values.penalty)}" />
                </label>
                <button type="submit" class="primary">設定を保存</button>
            </form>
        `;
        const configForm = document.getElementById('battleConfigForm');
        if (configForm) {
            const updateDraft = () => {
                const draftRef = ensureConfigDraft(game);
                if (!draftRef) return;
                draftRef.values = {
                    rounds: configForm.elements.rounds?.value ?? '',
                    roundTimeSeconds: configForm.elements.roundTimeSeconds?.value ?? '',
                    placementPoints: configForm.elements.placementPoints?.value ?? '',
                    penalty: configForm.elements.penalty?.value ?? '',
                };
                draftRef.dirty = true;
                const activeEl = document.activeElement;
                if (activeEl && configForm.contains(activeEl) && activeEl.id) {
                    draftRef.focusId = activeEl.id;
                    if (typeof activeEl.selectionStart === 'number' && typeof activeEl.selectionEnd === 'number') {
                        draftRef.focusSelection = {
                            start: activeEl.selectionStart,
                            end: activeEl.selectionEnd,
                        };
                    } else {
                        draftRef.focusSelection = null;
                    }
                } else {
                    draftRef.focusId = null;
                    draftRef.focusSelection = null;
                }
            };
            configForm.addEventListener('input', updateDraft);
            if (draft.focusId) {
                const focusTarget = configForm.querySelector(`#${draft.focusId}`);
                if (focusTarget && typeof focusTarget.focus === 'function') {
                    focusTarget.focus({ preventScroll: true });
                    if (draft.focusSelection && typeof focusTarget.setSelectionRange === 'function') {
                        try {
                            focusTarget.setSelectionRange(draft.focusSelection.start, draft.focusSelection.end);
                        } catch (error) {
                            const length = focusTarget.value.length;
                            focusTarget.setSelectionRange(length, length);
                        }
                    }
                }
            }
            configForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!state.roomId || !state.token) return;
                const formData = new FormData(configForm);
                const payload = {
                    token: state.token,
                    config: {
                        rounds: Number(formData.get('rounds')),
                        roundTimeSeconds: Number(formData.get('roundTimeSeconds')),
                        placementPoints: String(formData.get('placementPoints') || ''),
                        penalty: Number(formData.get('penalty')),
                    },
                };
                try {
                    const response = await apiRequest(`${API_ROOT}/rooms/${encodeURIComponent(state.roomId)}/config`, {
                        method: 'POST',
                        body: payload,
                    });
                    if (response && response.config) {
                        drafts.config = {
                            roomId: game.id,
                            values: {
                                rounds: String(response.config.rounds ?? payload.config.rounds),
                                roundTimeSeconds: String(response.config.roundTimeSeconds ?? payload.config.roundTimeSeconds),
                                placementPoints: String((response.config.placementPoints || []).join(', ')),
                                penalty: String(response.config.penalty ?? payload.config.penalty),
                            },
                            dirty: false,
                            focusId: null,
                            focusSelection: null,
                        };
                    } else {
                        drafts.config = {
                            roomId: game.id,
                            values: {
                                rounds: String(payload.config.rounds),
                                roundTimeSeconds: String(payload.config.roundTimeSeconds),
                                placementPoints: payload.config.placementPoints,
                                penalty: String(payload.config.penalty),
                            },
                            dirty: false,
                            focusId: null,
                            focusSelection: null,
                        };
                    }
                    state.game = response.game;
                    setFeedback('設定を更新しました。', 'ok');
                    renderAll();
                } catch (error) {
                    console.error('Failed to update configuration', error);
                    setFeedback(error.message || '設定の更新に失敗しました。', 'bad');
                }
            });
        }
    }

    function renderControlsSection(game) {
        const controlsEl = document.getElementById('battleControlsSection');
        if (!controlsEl || !game) return;
        const isHost = Boolean(game.me?.isHost);
        if (!isHost) {
            controlsEl.innerHTML = '';
            return;
        }
        const canStart = game.state === 'waiting' || game.state === 'results';
        if (!canStart) {
            controlsEl.innerHTML = '';
            return;
        }
        const disabled = !game.config || game.settingsLocked;
        controlsEl.innerHTML = `
            <button type="button" id="battleStartBtn" class="primary" ${disabled ? 'disabled' : ''}>ゲーム開始</button>
            <p class="battle-help-text">設定を確認してからゲームを開始してください。</p>
        `;
        const startBtn = document.getElementById('battleStartBtn');
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                if (!state.roomId || !state.token || disabled) return;
                try {
                    const response = await apiRequest(`${API_ROOT}/rooms/${encodeURIComponent(state.roomId)}/start`, {
                        method: 'POST',
                        body: { token: state.token },
                    });
                    state.game = response.game;
                    setFeedback('ゲームを開始しました。', 'ok');
                    configureTimer(state.game);
                    renderAll();
                } catch (error) {
                    console.error('Failed to start game', error);
                    setFeedback(error.message || 'ゲーム開始に失敗しました。', 'bad');
                }
            });
        }
    }

    function renderLobby(game) {
        if (!lobbyEl) return;
        if (!game || !state.token) {
            renderJoinForm();
            return;
        }

        const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.roomId)}`;
        const playersHtml = buildScoreboard(game.players, game.me?.id);
        const historyHtml = buildHistory(game.history);
        lobbyEl.innerHTML = `
            <div class="battle-section">
                <div class="battle-room-meta">
                    <div><strong>ルームID:</strong> <code>${state.roomId}</code></div>
                    <button type="button" id="battleCopyLinkBtn" class="ghost small">ルームURLをコピー</button>
                </div>
            </div>
            <div class="battle-section">
                <h4>プレイヤー</h4>
                ${playersHtml}
                <button type="button" id="battleLeaveBtn" class="ghost small danger">ルームから退出</button>
            </div>
            <div class="battle-section" id="battleConfigSection"></div>
            <div class="battle-section" id="battleControlsSection"></div>
            <div class="battle-section">
                <h4>ラウンド結果</h4>
                ${historyHtml}
            </div>
        `;

        const copyBtn = document.getElementById('battleCopyLinkBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(shareUrl);
                    setFeedback('ルームURLをコピーしました。', 'ok');
                } catch (error) {
                    console.warn('Clipboard copy failed', error);
                    setFeedback('コピーに失敗しました。', 'warn');
                }
            });
        }

        const leaveBtn = document.getElementById('battleLeaveBtn');
        if (leaveBtn) {
            leaveBtn.addEventListener('click', async () => {
                if (!state.roomId || !state.token) return;
                try {
                    await apiRequest(`${API_ROOT}/rooms/${encodeURIComponent(state.roomId)}/leave`, {
                        method: 'POST',
                        body: { token: state.token },
                    });
                } catch (error) {
                    console.warn('Failed to leave room', error);
                } finally {
                    clearSession();
                    stopPolling();
                    stopTimer();
                    lastRenderedProblemKey = null;
                    state.roomId = null;
                    state.token = null;
                    state.game = null;
                    renderAll();
                }
            });
        }

        renderConfigSection(game);
        renderControlsSection(game);
    }

    function renderRoundSummary(game) {
        if (!summaryEl || !game) return;
        summaryEl.innerHTML = '';
        if (game.state === 'results' && Array.isArray(game.results)) {
            const rows = game.results.map((entry, index) => `
                <tr class="${game.me && entry.id === game.me.id ? 'battle-row-me' : ''}">
                    <td>${index + 1}</td>
                    <td>${entry.name}</td>
                    <td>${entry.score}</td>
                </tr>
            `).join('');
            summaryEl.innerHTML = `
                <div class="battle-results">
                    <h3>最終結果</h3>
                    <table class="battle-scoreboard">
                        <thead>
                            <tr><th>順位</th><th>プレイヤー</th><th>得点</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
            return;
        }
        const round = game.round;
        if (!round || round.status !== 'finished') {
            summaryEl.innerHTML = '';
            return;
        }
        const winners = round.correct && round.correct.length
            ? round.correct.map((entry) => `${entry.placement}位: ${entry.name} (+${entry.awarded})`).join(' / ')
            : '該当なし';
        const reason = round.finishReason === 'time'
            ? '時間切れで終了'
            : round.finishReason === 'max_correct'
                ? '規定人数が正解'
                : 'ラウンド終了';
        summaryEl.innerHTML = `
            <div class="battle-round-summary">
                <div><strong>${reason}</strong></div>
                <div>${winners}</div>
            </div>
        `;
    }

    function renderProblem(game) {
        if (!answerFormEl) return;
        if (!game || !game.round || !game.round.problem || (game.round.status !== 'active' && game.round.status !== 'finished')) {
            problemTitleEl.textContent = 'バトルに参加して問題を解きましょう';
            problemStatementEl.textContent = '';
            answerFormEl.innerHTML = '<p class="battle-placeholder">問題はまだ出題されていません。</p>';
            lastRenderedProblemKey = null;
            return;
        }

        const round = game.round;
        problemTitleEl.textContent = round.problem.title || `ラウンド ${round.index}`;
        problemStatementEl.innerHTML = round.problem.statement || '';

        const problemKey = `${round.problem.id}:${round.index}:${round.status}`;
        let preservedValues = null;
        let preservedActiveId = null;
        let preservedSelection = null;

        if (problemKey === lastRenderedProblemKey) {
            preservedValues = {};
            const existingElements = Array.from(answerFormEl.elements || []);
            existingElements.forEach((el) => {
                if (!el) return;
                const key = el.name || el.id;
                if (!key) return;
                preservedValues[key] = el.value;
            });
            const activeEl = document.activeElement;
            if (activeEl && answerFormEl.contains(activeEl) && activeEl.id) {
                preservedActiveId = activeEl.id;
                if (typeof activeEl.selectionStart === 'number' && typeof activeEl.selectionEnd === 'number') {
                    preservedSelection = {
                        start: activeEl.selectionStart,
                        end: activeEl.selectionEnd,
                    };
                }
            }
        }

        const inputs = Array.isArray(round.problem.inputs) ? round.problem.inputs : [];
        answerFormEl.innerHTML = '';
        if (!inputs.length) {
            answerFormEl.innerHTML = '<p class="battle-placeholder">この問題には入力がありません。正解をサーバー側で判定します。</p>';
            lastRenderedProblemKey = problemKey;
            return;
        }

        inputs.forEach((input) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'row battle-input-row';
            const label = document.createElement('label');
            label.className = 'battle-label';
            label.setAttribute('for', input.id);
            label.textContent = input.label || input.id;
            let field;
            if (input.type === 'textarea') {
                field = document.createElement('textarea');
                field.rows = input.rows || 3;
            } else {
                field = document.createElement('input');
                field.type = input.type === 'number' ? 'number' : 'text';
            }
            field.id = input.id;
            field.name = input.id;
            if (input.placeholder) field.placeholder = input.placeholder;
            if (input.value !== undefined) field.value = input.value;
            if (Object.prototype.hasOwnProperty.call(input, 'min') && 'min' in field) {
                field.min = input.min;
            }
            if (Object.prototype.hasOwnProperty.call(input, 'max') && 'max' in field) {
                field.max = input.max;
            }
            if (Object.prototype.hasOwnProperty.call(input, 'step') && 'step' in field) {
                field.step = input.step;
            }
            if (preservedValues && Object.prototype.hasOwnProperty.call(preservedValues, input.id)) {
                field.value = preservedValues[input.id];
            }
            wrapper.appendChild(label);
            wrapper.appendChild(field);
            answerFormEl.appendChild(wrapper);
        });

        if (preservedActiveId) {
            const focusTarget = answerFormEl.querySelector(`#${preservedActiveId}`);
            if (focusTarget && typeof focusTarget.focus === 'function') {
                focusTarget.focus({ preventScroll: true });
                if (preservedSelection && typeof focusTarget.setSelectionRange === 'function') {
                    try {
                        focusTarget.setSelectionRange(preservedSelection.start, preservedSelection.end);
                    } catch (error) {
                        const length = focusTarget.value.length;
                        focusTarget.setSelectionRange(length, length);
                    }
                }
            }
        }

        lastRenderedProblemKey = problemKey;
    }

    function updateBadges(game) {
        if (!roomBadgeEl || !roundBadgeEl || !stateBadgeEl) return;
        if (!game) {
            roomBadgeEl.textContent = '';
            roundBadgeEl.textContent = '';
            stateBadgeEl.textContent = '';
            return;
        }
        roomBadgeEl.textContent = `Room: ${state.roomId || '-'}`;
        const roundIndex = game.round ? game.round.index : (game.history?.length || 0) + 1;
        const planned = game.totals?.roundsPlanned || '-';
        roundBadgeEl.textContent = `Round ${roundIndex}/${planned}`;
        const label = game.state === 'waiting'
            ? '待機中'
            : game.state === 'active'
                ? '進行中'
                : '結果';
        stateBadgeEl.textContent = label;
    }

    function renderAll() {
        renderLobby(state.game);
        renderProblem(state.game);
        renderRoundSummary(state.game);
        updateBadges(state.game);
    }

    async function joinRoom({ name, roomId }) {
        state.joining = true;
        setFeedback('');
        try {
            const payload = {
                name,
                roomId,
                token: state.token || undefined,
            };
            const response = await apiRequest(`${API_ROOT}/rooms/join`, {
                method: 'POST',
                body: payload,
            });
            state.roomId = response.roomId;
            state.token = response.playerToken;
            state.game = response.game;
            persistSession();
            configureTimer(state.game);
            renderAll();
            startPolling();
            setFeedback(response.rejoined ? 'ルームに再参加しました。' : 'ルームに参加しました。', 'ok');
            await fetchState();
        } catch (error) {
            console.error('Failed to join room', error);
            setFeedback(error.message || 'ルームに参加できませんでした。', 'bad');
        } finally {
            state.joining = false;
            renderAll();
        }
    }

    async function fetchState() {
        if (!state.roomId) return;
        const query = state.token ? `?token=${encodeURIComponent(state.token)}` : '';
        try {
            const response = await apiRequest(`${API_ROOT}/rooms/${encodeURIComponent(state.roomId)}/state${query}`);
            state.game = response.game;
            if (response.roomId) {
                state.roomId = response.roomId;
            }
            configureTimer(state.game);
            renderAll();
        } catch (error) {
            console.warn('Failed to fetch state', error);
            if (error.status === 404) {
                setFeedback('ルームが見つかりません。新しく参加し直してください。', 'bad');
                clearSession();
                state.roomId = null;
                state.token = null;
                state.game = null;
                stopPolling();
                stopTimer();
                lastRenderedProblemKey = null;
                renderAll();
            } else if (error.status === 401) {
                setFeedback('トークンが無効です。再参加してください。', 'bad');
                clearSession();
                state.token = null;
            }
        }
    }

    async function submitAnswer(event) {
        event.preventDefault();
        if (!state.roomId || !state.token || !state.game || !state.game.round || state.game.round.status !== 'active') {
            setFeedback('現在回答を送信できません。', 'warn');
            return;
        }
        const formData = new FormData(answerFormEl);
        const answers = {};
        formData.forEach((value, key) => {
            answers[key] = typeof value === 'string' ? value.trim() : value;
        });
        const submitBtn = answerFormEl.querySelector('button[type="submit"], .primary');
        if (submitBtn) submitBtn.disabled = true;
        try {
            const response = await apiRequest(`${API_ROOT}/rooms/${encodeURIComponent(state.roomId)}/answer`, {
                method: 'POST',
                body: {
                    token: state.token,
                    answers,
                },
            });
            state.game = response.game;
            configureTimer(state.game);
            renderAll();
            if (response.correct) {
                const placementText = response.placement ? `${response.placement}位で正解！` : '正解です！';
                const points = response.awarded ? ` +${response.awarded}点` : '';
                setFeedback(`${placementText}${points}`, 'ok');
                answerFormEl.reset();
            } else if (response.penaltyApplied) {
                setFeedback(`不正解です。-${response.penalty || 0}点`, 'warn');
            } else if (response.alreadySolved) {
                setFeedback('すでに正解済みです。', 'warn');
            } else if (response.message) {
                setFeedback(response.message, 'warn');
            } else {
                setFeedback('不正解です。', 'warn');
            }
        } catch (error) {
            console.error('Failed to submit answer', error);
            setFeedback(error.message || '回答の送信に失敗しました。', 'bad');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    function readQueryParam(name) {
        try {
            return new URL(window.location.href).searchParams.get(name);
        } catch (error) {
            return null;
        }
    }

    function init() {
        renderAll();

        if (answerFormEl) {
            answerFormEl.addEventListener('submit', submitAnswer);
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', (event) => {
                event.preventDefault();
                answerFormEl?.reset();
                setFeedback('入力をクリアしました。', 'ok');
            });
        }

        const stored = loadSession();
        const queryRoom = (readQueryParam('room') || '').trim().toUpperCase();
        if (queryRoom) {
            state.roomId = queryRoom;
        } else if (stored && stored.roomId) {
            state.roomId = stored.roomId;
        }
        if (stored && stored.playerToken) {
            state.token = stored.playerToken;
        }

        if (state.roomId && state.token) {
            joinRoom({ roomId: state.roomId }).catch((error) => {
                console.warn('Auto rejoin failed', error);
                renderAll();
            });
        } else {
            renderAll();
        }

        startPolling();
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPolling();
        } else if (state.roomId) {
            fetchState().finally(() => {
                startPolling();
            });
        } else {
            startPolling();
        }
    });

    init();
})();
