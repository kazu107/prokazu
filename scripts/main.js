/* =============================================================

   使い方 / How to add problems

   -------------------------------------------------------------

   1) 下の PROBLEMS にオブジェクトを追加するだけ。

      必須プロパティ:

        - id        : 一意なID（URLは ?id=このID）

        - title     : タイトル

        - statement : HTML文字列（<em>, <code> 可）

        - inputs    : 回答フィールドの配列

            { id, label, type:"number"|"text", placeholder }

        - check(answers, utils): ユーザー回答を検証する関数

            - answers は { [input.id]: string } で渡る

            - return 形式: { ok:boolean, message?:string }

   2) 追加したら、左の Problems リストに自動で出ます。

   3) ページ切替: 例) index.html?id=p2

   -------------------------------------------------------------

   utils: よく使う補助関数を同梱（数値パース、素数判定など）

   ============================================================= */



const utils = {

    parseNum: (v) => {

        if (v === null || v === undefined || v === '') return NaN;

        // 10進の整数/小数を許可。指数形式もNumberに委ねる

        const n = Number(v);

        return Number.isFinite(n) ? n : NaN;

    },

    isInt: (x) => Number.isInteger(x),

    eqNum: (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9,

    gcd: (a,b) => { a=Math.abs(a); b=Math.abs(b); while(b){[a,b]=[b,a%b]} return a; },

    isPrime: (n) => {

        n = Math.floor(n);

        if (n < 2) return false; if (n % 2 === 0) return n === 2; if (n % 3 === 0) return n === 3;

        const r = Math.floor(Math.sqrt(n));

        for (let f=5; f<=r; f+=6) { if (n%f===0 || n%(f+2)===0) return false; }

        return true;

    },

    nthPrime: (k) => { let c=0,n=1; while(c<k){ n++; if(utils.isPrime(n)) c++; } return n; },

    sumMultiplesBelow: (limit, a, b) => {

        const sumOf = (m) => { const n = Math.floor((limit-1)/m); return m * n * (n+1) / 2; };

        return sumOf(a) + sumOf(b) - sumOf(a*b/utils.gcd(a,b));

    },

    shuffle: (arr) => arr.sort(()=>Math.random()-0.5),

};



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

const formEl = $('#answerForm');

const statusEl = $('#statusBox');

const hintsEl = $('#hints');

const solvedMarkEl = $('#solvedMark');

const resetBtn = $('#resetBtn');

const shareLink = $('#shareLink');

const actionsEl = document.querySelector('.actions');

const homeLink = document.querySelector('#homeLink');



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

    disableActions();
}

function renderProblemNotFound(id) {
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

    disableActions();
}

function renderProblem(p) {
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
    stmtEl.innerHTML = p.statement;
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
    formEl.onsubmit = (ev) => {
        ev.preventDefault();
        statusEl.style.display = 'none';
        const answers = Object.fromEntries(new FormData(formEl).entries());

        const { ok, message } = p.check(answers, utils) || { ok:false };
        if (ok) {
            storage.markSolved(p.id);
            solvedMarkEl.textContent = 'Solved';
            buildProblemList(p.id);
            showStatus(message || 'Correct!', 'ok');
        } else {
            solvedMarkEl.textContent = storage.isSolved(p.id) ? 'Solved' : '';
            showStatus(message || 'Incorrect. Try again!', 'bad');
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











































