/* =============================================================
   Problem data overview
   -------------------------------------------------------------
   - Problem metadata (including validation rules) lives in
     scripts/problems.js which is shared with the Node backend.
   - Each problem object defines: id, title, HTML statement,
     inputs, explanation, and a server-side check function.
   - Problems are grouped via window.PROBLEM_GROUPS for the UI.
   - Example deep link: index.html?id=p2
   ============================================================= */
const PROBLEMS = Array.isArray(window.ALL_PROBLEMS) ? window.ALL_PROBLEMS : [];
const PROBLEM_MAP = new Map(PROBLEMS.map((p) => [p.id, p]));

const RAW_GROUPS = Array.isArray(window.PROBLEM_GROUPS) ? window.PROBLEM_GROUPS : [];
const PROBLEM_GROUPS = RAW_GROUPS.map((group) => {
    const collected = [];
    const seen = new Set();

    const addProblem = (prob) => {
        if (!prob || typeof prob !== 'object') return;
        const pid = prob.id;
        if (!pid || seen.has(pid)) return;
        seen.add(pid);
        collected.push(prob);
    };

    const addById = (id) => {
        if (typeof id !== 'string') return;
        const prob = PROBLEM_MAP.get(id);
        if (prob) addProblem(prob);
    };

    if (Array.isArray(group.problemIds)) {
        group.problemIds.forEach(addById);
    }
    if (Array.isArray(group.problems)) {
        group.problems.forEach((entry) => {
            if (typeof entry === 'string') {
                addById(entry);
            } else {
                addProblem(entry);
            }
        });
    }

    if (!collected.length && group.includeAll) {
        PROBLEMS.forEach(addProblem);
    }

    return { ...group, problems: collected };
});



const autoResizeTextarea = (field) => {
    if (!field) return;
    field.style.height = 'auto';
    const baseHeight = Number(field.dataset.minHeight) || field.scrollHeight || 44;
    field.style.height = `${Math.max(field.scrollHeight, baseHeight)}px`;
};

const enableAutoResize = (field) => {
    if (!field || field.dataset.autoResize === 'on') return;
    field.dataset.autoResize = 'on';
    field.dataset.minHeight = field.scrollHeight || 44;
    field.style.overflow = 'hidden';
    autoResizeTextarea(field);
    field.addEventListener('input', () => autoResizeTextarea(field));
};



// -------------------------

// Storage helpers (per problem id)

// -------------------------

const storage = {
    keySolved: (id) => `pe_solved_${id}`,
    markSolved(id) { localStorage.setItem(this.keySolved(id), '1'); },
    clear(id) { localStorage.removeItem(this.keySolved(id)); },
    isSolved(id) { return localStorage.getItem(this.keySolved(id)) === '1'; }
};


// -------------------------

// URL utils

// -------------------------

function getParam(name) {

    const url = new URL(window.location.href);

    return url.searchParams.get(name);

}

function setClipboard(text) {

    navigator.clipboard?.writeText(text).catch(()=>{});

}



// -------------------------

// UI rendering / behavior

// -------------------------

const $ = (sel) => document.querySelector(sel);

const listEl = $('#problemList');

const idBadge = $('#problemIdBadge');
const difficultyBadge = $('#problemDifficultyBadge');

const titleEl = $('#problemTitle');

const stmtEl = $('#problemStatement');
const explanationEl = $('#problemExplanation');

const tabButtons = Array.from(document.querySelectorAll('[data-problem-tab]'));
const tabPanels = Array.from(document.querySelectorAll('[data-problem-panel]'));

const formEl = $('#answerForm');

const statusEl = $('#statusBox');

const hintsEl = $('#hints');

const solvedMarkEl = $('#solvedMark');

const resetBtn = $('#resetBtn');

const shareLink = $('#shareLink');

const actionsEl = document.querySelector('.actions');
const footEl = document.querySelector('.foot');

const CHECK_ENDPOINT = '/api/check';

const boardPanel = $('#problemBoard');
const boardForm = $('#problemBoardForm');
const boardNameInput = $('#boardName');
const boardMessageInput = $('#boardMessage');
const boardMessagesEl = $('#problemBoardMessages');
const boardFeedbackEl = $('#problemBoardFeedback');

const homeLink = document.querySelector('#homeLink');

const EXPLANATION_PLACEHOLDER_HTML = '<p>Explanation will be added soon.</p>';
const TAB_HIDE_MAP = {
    explanation: [formEl, actionsEl, statusEl, hintsEl, footEl],
    board: [formEl, actionsEl, statusEl, hintsEl, footEl],
};
const TAB_HIDE_ELEMENTS = Array.from(new Set(Object.values(TAB_HIDE_MAP).flat().filter(Boolean)));

if (boardMessageInput) {
    enableAutoResize(boardMessageInput);
}

const rememberDisplay = (el) => {
    if (!el) return;
    if (el.dataset.tabPrevDisplayStored === '1') return;
    el.dataset.tabPrevDisplayStored = '1';
    el.dataset.tabPrevDisplay = el.style.display || '';
};

const restoreDisplay = (el) => {
    if (!el) return;
    if (el.dataset.tabPrevDisplayStored !== '1') return;
    el.style.display = el.dataset.tabPrevDisplay || '';
    delete el.dataset.tabPrevDisplayStored;
    delete el.dataset.tabPrevDisplay;
};

const showProblemTab = (target) => {
    if (!tabPanels.length || !tabButtons.length) return;
    const available = new Set(tabPanels.map((panel) => panel.dataset.problemPanel));
    const key = available.has(target) ? target : 'statement';

    tabButtons.forEach((btn) => {
        const isActive = btn.dataset.problemTab === key;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    tabPanels.forEach((panel) => {
        const shouldShow = panel.dataset.problemPanel === key;
        panel.hidden = !shouldShow;
        panel.setAttribute('tabindex', shouldShow ? '0' : '-1');
    });

    const hideList = new Set(TAB_HIDE_MAP[key] || []);
    TAB_HIDE_ELEMENTS.forEach((el) => {
        if (!el) return;
        if (hideList.has(el)) {
            rememberDisplay(el);
            el.style.display = 'none';
        } else {
            restoreDisplay(el);
        }
    });
};

if (tabButtons.length) {
    tabButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            showProblemTab(btn.dataset.problemTab);
        });
        btn.addEventListener('keydown', (ev) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(ev.key)) return;
            ev.preventDefault();
            const dir = ev.key === 'ArrowRight' ? 1 : -1;
            const idx = tabButtons.indexOf(btn);
            if (idx < 0) return;
            const nextIdx = (idx + dir + tabButtons.length) % tabButtons.length;
            const nextBtn = tabButtons[nextIdx];
            nextBtn?.focus();
            nextBtn?.click();
        });
    });
    showProblemTab('statement');
}



const BOARD_MESSAGES = new Map();
let activeProblemId = null;
let boardFeedbackTimer = null;

const setBoardFeedback = (message, tone) => {
    if (!boardFeedbackEl) return;
    if (boardFeedbackTimer) {
        clearTimeout(boardFeedbackTimer);
        boardFeedbackTimer = null;
    }
    if (!message) {
        boardFeedbackEl.textContent = '';
        boardFeedbackEl.removeAttribute('data-tone');
        return;
    }
    boardFeedbackEl.textContent = message;
    if (tone) {
        boardFeedbackEl.setAttribute('data-tone', tone);
    } else {
        boardFeedbackEl.removeAttribute('data-tone');
    }
    boardFeedbackTimer = window.setTimeout(() => {
        boardFeedbackEl.textContent = '';
        boardFeedbackEl.removeAttribute('data-tone');
        boardFeedbackTimer = null;
    }, 3200);
};

const setBoardAvailability = (enabled, placeholderHtml) => {
    if (!boardForm) return;
    Array.from(boardForm.elements).forEach((el) => {
        if (typeof el.disabled === 'boolean') {
            el.disabled = !enabled;
        }
    });
    if (!enabled) {
        boardForm.reset();
        if (boardMessageInput) {
            boardMessageInput.dispatchEvent(new Event('input'));
        }
    }
    setBoardFeedback('');
    if (boardMessagesEl && placeholderHtml !== undefined) {
        boardMessagesEl.innerHTML = '';
        if (placeholderHtml) {
            const placeholder = document.createElement('p');
            placeholder.className = 'board-placeholder';
            placeholder.innerHTML = placeholderHtml;
            boardMessagesEl.appendChild(placeholder);
        }
    }
};

const formatBoardTimestamp = (ms) => {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('ja-JP', { hour12: false });
};

const renderBoardMessages = (problemId) => {
    if (!boardMessagesEl) return;
    boardMessagesEl.innerHTML = '';

    const posts = BOARD_MESSAGES.get(problemId) || [];
    if (!posts.length) {
        return;
    }

    posts.forEach((post) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'board-post';

        const author = document.createElement('div');
        author.className = 'author';
        author.textContent = post.name || '匿名';
        wrapper.appendChild(author);

        const timestamp = document.createElement('div');
        timestamp.className = 'timestamp';
        timestamp.textContent = formatBoardTimestamp(post.createdAt);
        if (timestamp.textContent) {
            wrapper.appendChild(timestamp);
        }

        const message = document.createElement('div');
        message.className = 'message';
        message.textContent = post.message;
        wrapper.appendChild(message);

        boardMessagesEl.appendChild(wrapper);
    });

    boardMessagesEl.lastElementChild?.scrollIntoView({ block: 'end' });
};

function handleBoardSubmit(event) {
    event.preventDefault();
    if (!activeProblemId) {
        setBoardFeedback('Please select a problem before posting.', 'error');
        return;
    }

    const nameRaw = (boardNameInput?.value || '').trim();
    const messageRaw = (boardMessageInput?.value || '').trim();

    if (!messageRaw) {
        setBoardFeedback('Please enter a message.', 'error');
        boardMessageInput?.focus();
        return;
    }

    const entry = {
        id: Date.now(),
        name: nameRaw || '匿名',
        message: messageRaw,
        createdAt: Date.now(),
    };

    const list = BOARD_MESSAGES.get(activeProblemId) || [];
    list.push(entry);
    BOARD_MESSAGES.set(activeProblemId, list);

    if (boardMessageInput) {
        boardMessageInput.value = '';
        boardMessageInput.dispatchEvent(new Event('input'));
    }

    renderBoardMessages(activeProblemId);
    setBoardFeedback('Posted your message.', 'success');
}

if (boardForm) {
    boardForm.addEventListener('submit', handleBoardSubmit);
}



function buildProblemList(currentId) {
    listEl.innerHTML = '';
    const groups = PROBLEM_GROUPS.length ? PROBLEM_GROUPS : [{ title: 'Problems', problems: PROBLEMS }];

    groups.forEach((group) => {
        const details = document.createElement('details');
        details.className = 'group';
        if (group.id) {
            details.dataset.groupId = group.id;
        }
        if ((group.problems || []).some((p) => p.id === currentId) || group.defaultOpen) {
            details.open = true;
        }

        const summary = document.createElement('summary');
        const caret = document.createElement('span');
        caret.className = 'caret';
        caret.setAttribute('aria-hidden', 'true');
        summary.appendChild(caret);

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = group.title || 'Problems';
        summary.appendChild(label);

        details.appendChild(summary);

        const container = document.createElement('div');
        container.className = 'sublist';

        (group.problems || []).forEach((p) => {
            const isCurrent = p.id === currentId;
            const isSolved = storage.isSolved(p.id);
            const a = document.createElement('a');
            a.className = `item${isSolved ? ' solved' : ''}${isCurrent ? ' current' : ''}`;
            if (isCurrent) {
                a.setAttribute('aria-current', 'page');
            }
            a.href = `${location.pathname}?id=${encodeURIComponent(p.id)}`;
            a.innerHTML = `<div><strong>${p.title}</strong><div class="muted mono">id=${p.id}</div></div>`;
            container.appendChild(a);
        });

        if (!container.childElementCount) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'このグループには問題がありません';
            container.appendChild(empty);
        }

        details.appendChild(container);
        listEl.appendChild(details);
    });
}

function disableActions() {
    if (actionsEl) {
        actionsEl.style.display = 'none';
    }
    resetBtn.disabled = true;
    resetBtn.onclick = null;

    shareLink.href = '#';
    shareLink.onclick = (e) => { e.preventDefault(); };
    shareLink.classList.add('disabled');
    shareLink.setAttribute('aria-disabled', 'true');
    shareLink.style.pointerEvents = 'none';
    shareLink.style.opacity = '0.5';
}

function renderLanding() {
    activeProblemId = null;

    idBadge.textContent = 'ID: -';
    idBadge.style.display = '';
    difficultyBadge.textContent = '';
    difficultyBadge.style.display = 'none';

    titleEl.textContent = 'Euler-like Problems について';
    stmtEl.innerHTML = `
        <p>このサイトでは Project Euler 風の数学パズルをブラウザだけで学習できます。</p>
        <ol>
            <li>左のリストから挑戦したい問題を選びます。</li>
            <li>問題文の下にある入力欄へ答えを入力し、「提出」ボタンを押します。</li>
            <li>正解すると緑のフィードバックが表示され、問題は「Solved」として記録されます。</li>
            <li>ヒントは必要に応じて開閉でき、段階的に確認できます。</li>
        </ol>
        <p>最初の問題を選んでウォームアップから始めてみましょう。</p>
    `;

    solvedMarkEl.textContent = '';
    statusEl.style.display = 'none';
    statusEl.textContent = '';

    hintsEl.innerHTML = '';
    hintsEl.style.display = 'none';

    formEl.replaceChildren();
    formEl.onsubmit = null;

    if (explanationEl) {
        explanationEl.innerHTML = '<p>Select a problem from the list to view its explanation here.</p>';
    }

    if (boardPanel) {
        setBoardAvailability(false, 'Select a problem to use the board.');
    }

    disableActions();
    showProblemTab('statement');
}

function renderProblemNotFound(id) {
    activeProblemId = null;

    idBadge.textContent = `ID: ${id}`;
    idBadge.style.display = '';
    difficultyBadge.textContent = '';
    difficultyBadge.style.display = 'none';

    titleEl.textContent = 'Problem not found';
    stmtEl.innerHTML = `
        <p>指定された ID <code class="mono">${id}</code> の問題は見つかりませんでした。</p>
        <p>左側のリストから存在する問題を選び直してください。</p>
    `;

    solvedMarkEl.textContent = '';
    statusEl.style.display = 'none';
    statusEl.textContent = '';

    hintsEl.innerHTML = '';
    hintsEl.style.display = 'none';

    formEl.replaceChildren();
    formEl.onsubmit = null;

    if (explanationEl) {
        explanationEl.innerHTML = '<p>Explanation is unavailable for a missing problem.</p>';
    }

    if (boardPanel) {
        setBoardAvailability(false, 'This board is unavailable for a missing problem.');
    }

    disableActions();
    showProblemTab('statement');
}

function renderProblem(p) {
    activeProblemId = p.id;

    idBadge.textContent = `ID: ${p.id}`;
    idBadge.style.display = '';

    if (p.difficulty) {
        difficultyBadge.textContent = `Difficulty: ${p.difficulty}`;
        difficultyBadge.style.display = '';
    } else {
        difficultyBadge.textContent = '';
        difficultyBadge.style.display = 'none';
    }

    titleEl.textContent = p.title;
    stmtEl.innerHTML = p.statement || '';
    if (explanationEl) {
        let explanationHtml = '';
        if (typeof p.explanation === 'function') {
            try {
                explanationHtml = p.explanation(p);
            } catch (err) {
                console.error(err);
            }
        } else if (typeof p.explanation === 'string') {
            explanationHtml = p.explanation;
        }
        explanationEl.innerHTML = (typeof explanationHtml === 'string' && explanationHtml.trim())
            ? explanationHtml
            : EXPLANATION_PLACEHOLDER_HTML;
    }
    if (boardPanel) {
        setBoardAvailability(true);
        renderBoardMessages(p.id);
        setBoardFeedback('');
        if (boardMessageInput) {
            boardMessageInput.value = '';
            boardMessageInput.dispatchEvent(new Event('input'));
        }
    }
    showProblemTab('statement');
    solvedMarkEl.textContent = storage.isSolved(p.id) ? 'Solved' : '';
    statusEl.style.display = 'none';
    statusEl.textContent = '';

    if (actionsEl) {
        actionsEl.style.display = '';
    }
    resetBtn.disabled = false;
    shareLink.classList.remove('disabled');
    shareLink.removeAttribute('aria-disabled');
    shareLink.style.pointerEvents = 'auto';
    shareLink.style.opacity = '';

    // Hints
    const hints = Array.isArray(p.hints) ? p.hints : [];
    hintsEl.innerHTML = '';
    if (hints.length === 0) {
        hintsEl.style.display = 'none';
    } else {
        hintsEl.style.display = '';
    }
    hints.forEach((hint, idx) => {
        const details = document.createElement('details');
        details.className = 'hint';
        const summary = document.createElement('summary');
        const label = (hint && typeof hint === 'object' && hint.title)
            ? hint.title
            : `\u30d2\u30f3\u30c8${idx + 1}`;
        summary.textContent = label;
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'hint-body';
        const content = (hint && typeof hint === 'object')
            ? (hint.body || hint.content || '')
            : hint;
        if (typeof content === 'string') {
            body.innerHTML = content;
        } else {
            body.textContent = '';
        }
        details.appendChild(body);
        hintsEl.appendChild(details);
    });
    // Form
    formEl.replaceChildren();
    p.inputs.forEach((inp) => {
        const row = document.createElement('div');
        row.className = 'row';

        const lab = document.createElement('label');
        lab.setAttribute('for', inp.id);
        lab.textContent = inp.label;

        let field;
        if (inp.type === 'number') {
            field = document.createElement('input');
            field.type = 'number';
        } else if (inp.type === 'textarea') {
            field = document.createElement('textarea');
            field.rows = inp.rows || 1;
        } else {
            field = document.createElement('textarea');
            field.rows = inp.rows || 1;
        }

        field.name = inp.id;
        field.id = inp.id;
        field.placeholder = inp.placeholder || '';

        row.appendChild(lab);
        row.appendChild(field);
        formEl.appendChild(row);

        if (field.tagName === 'TEXTAREA') {
            enableAutoResize(field);
        }
    });

    // Submit handler
    formEl.onsubmit = async (ev) => {
        ev.preventDefault();
        statusEl.style.display = 'none';
        statusEl.textContent = '';
        const answers = Object.fromEntries(new FormData(formEl).entries());
        const submitBtn = actionsEl ? actionsEl.querySelector('button[type="submit"]') : null;

        if (submitBtn) submitBtn.disabled = true;
        showStatus('サーバーで判定中です…', 'warn');

        try {
            const response = await fetch(CHECK_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ problemId: p.id, answers }),
            });

            if (!response.ok) {
                throw new Error(`Unexpected response: ${response.status}`);
            }

            const payload = await response.json();
            const ok = !!payload.ok;
            const message = typeof payload.message === 'string'
                ? payload.message
                : ok
                    ? '正解です！'
                    : '不正解でした。';

            if (ok) {
                storage.markSolved(p.id);
                solvedMarkEl.textContent = 'Solved';
                buildProblemList(p.id);
                showStatus(message, 'ok');
            } else {
                solvedMarkEl.textContent = storage.isSolved(p.id) ? 'Solved' : '';
                showStatus(message, 'bad');
            }
        } catch (error) {
            console.error('Failed to verify answer', error);
            showStatus('サーバーでの判定に失敗しました。時間をおいて再試行してください。', 'warn');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    };

    // Reset & Share
    resetBtn.onclick = () => {
        storage.clear(p.id);
        solvedMarkEl.textContent = '';
        buildProblemList(p.id);
        showStatus('Solved state cleared for this problem.', 'warn');
    };

    shareLink.href = `${location.origin}${location.pathname}?id=${encodeURIComponent(p.id)}`;
    shareLink.onclick = (e) => {
        e.preventDefault();
        setClipboard(shareLink.href);
        showStatus('Problem link copied to clipboard.', 'ok');
    };
}



function navigateToProblem(id) {
    const currentId = id || null;
    buildProblemList(currentId);

    if (!id) {
        renderLanding();
        return;
    }

    const problem = PROBLEM_MAP.get(id);
    if (!problem) {
        renderProblemNotFound(id);
        return;
    }

    renderProblem(problem);
}

function renderFromParam() {
    navigateToProblem(getParam('id') || null);
}

function showStatus(text, kind) {

    statusEl.textContent = text; statusEl.className = `status ${kind||''}`; statusEl.style.display = 'block';

}



// -------------------------

// Boot

// -------------------------

(function init() {
    renderFromParam();

    if (homeLink) {
        const goHome = (event) => {
            if (event) {
                event.preventDefault();
            }
            if (location.search) {
                history.pushState({}, '', location.pathname);
            }
            navigateToProblem(null);
        };

        homeLink.addEventListener('click', goHome);
        homeLink.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                goHome(event);
            }
        });
    }

    window.addEventListener('popstate', renderFromParam);
})();











































