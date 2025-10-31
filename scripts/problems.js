/* =============================================================
   Problem definitions
   -------------------------------------------------------------
   - Problems are grouped into window.PROBLEM_GROUPS.
   - main.js consumes window.PROBLEM_GROUPS / window.ALL_PROBLEMS.
   ============================================================= */

window.ALL_PROBLEMS = [
    {
        id: 'p1',
        title: 'Multiples of 3 or 5 below 1000',
        difficulty: 'Easy',
        statement: `1000 未満の自然数のうち、<code>3</code> または <code>5</code> の倍数の総和を求めてください。<br />
                Enter the total sum (an integer).`,
        explanation: `
            <p>Apply inclusion-exclusion: sum multiples of 3 and of 5, then subtract the multiples of 15 to avoid double counting.</p>
            <p>The number of terms below 1000 for step m is floor((1000 - 1) / m); using m * n * (n + 1) / 2 yields the total 233168.</p>
        `,
        inputs: [
            { id: 'ans', label: 'Answer (解答 / Integer)', type: 'number', placeholder: 'e.g. 233168' },
        ],
        check: (answers) => {
            const a = utils.parseNum(answers.ans);
            const correct = utils.sumMultiplesBelow(1000, 3, 5); // 233168
            const ok = utils.eqNum(a, correct);
            return { ok, message: ok ? '正解です / Correct!' : '不正解です。次は別の視点で考えてみましょう。' };
        },
        hints: [
            '包除原理（inclusion-exclusion）を使ってみましょう。',
            '1 + 2 + ... + n の総和をどう表せますか？',
        ],
    },
    {
        id: 'p2',
        title: 'Find integers a, b (a + b = 10, ab = 21)',
        difficulty: 'Easy',
        statement: `整数 <em>a</em>, <em>b</em> が <code>a + b = 10</code>, <code>ab = 21</code> を満たすようにしてください。順序は問いません。`,
        explanation: `
            <p>Treat a and b as the roots of x^2 - 10x + 21 = 0 that comes from the sum and product constraints.</p>
            <p>Factoring into (x - 3)(x - 7) = 0 shows the only integer pairs are (3, 7) and (7, 3).</p>
        `,
        inputs: [
            { id: 'a', label: 'a', type: 'number', placeholder: 'e.g. 3' },
            { id: 'b', label: 'b', type: 'number', placeholder: 'e.g. 7' },
        ],
        check: (answers) => {
            const a = utils.parseNum(answers.a);
            const b = utils.parseNum(answers.b);
            const ok = utils.isInt(a) && utils.isInt(b) && (a + b === 10) && (a * b === 21);
            return { ok, message: ok ? '正解: (a,b) = (3,7) または (7,3)' : '条件をもう一度確認してみてください。' };
        },
        hints: [
            '二次方程式 x^2 - (a+b)x + ab = 0 を考えましょう。',
            '積と和が決まっている 2 つの整数をどう求めますか？',
        ],
    },
    {
        id: 'p3',
        title: 'Pythagorean triplet for which a + b + c = 1000',
        difficulty: 'Hard',
        statement: `<em>a &lt; b &lt; c</em> を満たすピタゴラス数 <code>a^2 + b^2 = c^2</code> で、さらに <code>a + b + c = 1000</code> となる組 <code>(a, b, c)</code> を求め、3 つの値を入力してください（整数）。`,
        explanation: `
            <p>Use Euclid's formula a = m^2 - n^2, b = 2mn, c = m^2 + n^2 (m > n) to generate Pythagorean triples.</p>
            <p>Substituting into a + b + c = 1000 yields 2m(m + n) = 1000, so choosing (m, n) = (20, 5) produces (a, b, c) = (200, 375, 425).</p>
        `,
        inputs: [
            { id: 'a', label: 'a', type: 'number', placeholder: 'e.g. 200' },
            { id: 'b', label: 'b', type: 'number', placeholder: 'e.g. 375' },
            { id: 'c', label: 'c', type: 'number', placeholder: 'e.g. 425' },
        ],
        check: (answers) => {
            const a = utils.parseNum(answers.a);
            const b = utils.parseNum(answers.b);
            const c = utils.parseNum(answers.c);
            const ok = [a, b, c].every(Number.isFinite)
                && a < b && b < c
                && a + b + c === 1000
                && (a * a + b * b === c * c);
            return { ok, message: ok ? '正解: 例として (200, 375, 425) になります。' : '三平方の定理と和が 1000 になる条件を満たしているか確認しましょう。' };
        },
        hints: [
            'Euclid の公式: a = m^2 - n^2, b = 2mn, c = m^2 + n^2 (m > n)。',
            'a + b + c = 1000 になる m, n の候補を探索しましょう。',
            'm, n が整数で互いに素の場合に注目すると探索が絞れます。',
        ],
    },
    {
        id: 'p4',
        title: 'The 10,001st prime',
        difficulty: 'Medium',
        statement: `10,001 番目の素数を求めてください。`,
        explanation: `
            <p>Count primes sequentially with trial division only up to sqrt(n) to test each candidate.</p>
            <p>Skip obvious composites by checking numbers of the form 6k +/- 1; continuing until 10,001 primes gives 104743.</p>
        `,
        inputs: [
            { id: 'ans', label: 'Answer (解答)', type: 'number', placeholder: 'e.g. 104743' },
        ],
        check: (answers) => {
            const a = utils.parseNum(answers.ans);
            const correct = utils.nthPrime(10001); // 104743
            const ok = utils.eqNum(a, correct);
            return { ok, message: ok ? '正解です！' : '素数判定のアルゴリズムを見直してみましょう。' };
        },
        hints: [
            '素数判定は sqrt(n) まで調べれば十分です。',
            '6k±1 の形の数を候補にすると効率良く探索できます。',
        ],
    },
];

window.PROBLEM_GROUPS = [
    {
        id: 'warmup',
        title: 'ウォームアップ',
        defaultOpen: true,
        problemIds: ['p1', 'p2'],
    },
    {
        id: 'number-theory',
        title: '数論チャレンジ',
        problemIds: ['p1', 'p4'],
    },
    {
        id: 'geometry',
        title: '幾何とピタゴラス',
        problemIds: ['p2', 'p3'],
    },
    {
        id: 'all-set',
        title: '全問題セット',
        includeAll: true,
    },
];
