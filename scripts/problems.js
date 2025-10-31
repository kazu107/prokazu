(function (globalScope, factory) {
    const data = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = data;
    } else if (globalScope) {
        const { problems, groups } = data;
        const publicProblems = problems.map(({ check, ...rest }) => ({ ...rest }));
        globalScope.ALL_PROBLEMS = publicProblems;
        globalScope.PROBLEM_GROUPS = groups;
    }
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, () => {
    const utils = {
        parseNum: (value) => {
            if (value === null || value === undefined || value === '') return NaN;
            const num = Number(value);
            return Number.isFinite(num) ? num : NaN;
        },
        isInt: (n) => Number.isInteger(n),
        eqNum: (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9,
        gcd: (a, b) => {
            let x = Math.abs(a);
            let y = Math.abs(b);
            while (y) {
                const tmp = y;
                y = x % y;
                x = tmp;
            }
            return x;
        },
        isPrime: (n) => {
            const num = Math.floor(n);
            if (num < 2) return false;
            if (num % 2 === 0) return num === 2;
            if (num % 3 === 0) return num === 3;
            const limit = Math.floor(Math.sqrt(num));
            for (let f = 5; f <= limit; f += 6) {
                if (num % f === 0 || num % (f + 2) === 0) return false;
            }
            return true;
        },
        nthPrime: (k) => {
            let count = 0;
            let n = 1;
            while (count < k) {
                n += 1;
                if (utils.isPrime(n)) count += 1;
            }
            return n;
        },
        sumMultiplesBelow: (limit, a, b) => {
            const sumOf = (step) => {
                const count = Math.floor((limit - 1) / step);
                return step * count * (count + 1) / 2;
            };
            const lcm = (x, y) => (x * y) / utils.gcd(x, y);
            return sumOf(a) + sumOf(b) - sumOf(lcm(a, b));
        },
    };

    const problems = [
        {
            id: 'p1',
            title: 'Multiples of 3 or 5 below 1000',
            difficulty: 'Easy',
            statement: `1000 未満の自然数のうち、<code>3</code> または <code>5</code> の倍数の総和を求めてください。<br />Enter the total sum (an integer).`,
            explanation: `
                <p>3 の倍数と 5 の倍数をそれぞれ合計し、重複して数えた 15 の倍数を差し引けば包除原理によって答えが求められます。</p>
                <p>等差数列の和は <code>m * n * (n + 1) / 2</code> で計算でき、ここで <code>n</code> は項数です。<code>n = floor((1000 - 1) / m)</code> として計算すると 233168 に到達します。</p>
            `,
            inputs: [
                { id: 'ans', label: 'Answer (整数)', type: 'number', placeholder: 'e.g. 233168' },
            ],
            check: (answers) => {
                const answer = utils.parseNum(answers.ans);
                const correct = utils.sumMultiplesBelow(1000, 3, 5);
                const ok = utils.eqNum(answer, correct);
                return {
                    ok,
                    message: ok ? '正解です！' : '不正解です。包除原理を使って再確認してみましょう。',
                };
            },
            hints: [
                '包除原理（inclusion-exclusion）で 3 と 5 の倍数の重複を調整しましょう。',
                '1 + 2 + ... + n の総和は n(n+1)/2 です。',
            ],
        },
        {
            id: 'p2',
            title: 'Find integers a, b (a + b = 10, ab = 21)',
            difficulty: 'Easy',
            statement: `整数 <em>a</em>, <em>b</em> が <code>a + b = 10</code>, <code>ab = 21</code> を満たすようにしてください。順序は問いません。`,
            explanation: `
                <p><code>a + b = 10</code> と <code>ab = 21</code> を満たす整数は、2 次方程式 <code>x^2 - 10x + 21 = 0</code> の解として求まります。</p>
                <p>因数分解すると <code>(x - 3)(x - 7) = 0</code> なので解は 3 と 7 です。順序を問わなければ (3, 7) と (7, 3) の 2 通りです。</p>
            `,
            inputs: [
                { id: 'a', label: 'a', type: 'number', placeholder: 'e.g. 3' },
                { id: 'b', label: 'b', type: 'number', placeholder: 'e.g. 7' },
            ],
            check: (answers) => {
                const a = utils.parseNum(answers.a);
                const b = utils.parseNum(answers.b);
                const ok = utils.isInt(a) && utils.isInt(b) && (a + b === 10) && (a * b === 21);
                return {
                    ok,
                    message: ok ? '正解です！ (a, b) = (3, 7) または (7, 3) です。' : '条件をもう一度確認してみましょう。',
                };
            },
            hints: [
                '和と積が決まっている 2 つの整数は二次方程式で求められます。',
                '方程式 <code>x^2 - 10x + 21 = 0</code> を解きましょう。',
            ],
        },
        {
            id: 'p3',
            title: 'Pythagorean triplet for which a + b + c = 1000',
            difficulty: 'Hard',
            statement: `<em>a &lt; b &lt; c</em> を満たすピタゴラス数 <code>a^2 + b^2 = c^2</code> で、さらに <code>a + b + c = 1000</code> となる組 <code>(a, b, c)</code> を求め、3 つの値を入力してください（整数）。`,
            explanation: `
                <p>ピタゴラス数は Euclid の公式 <code>a = m^2 - n^2</code>, <code>b = 2mn</code>, <code>c = m^2 + n^2</code> (m &gt; n) で生成できます。</p>
                <p><code>a + b + c = 1000</code> をこの公式に代入すると <code>2m(m + n) = 1000</code> となり、<code>(m, n) = (20, 5)</code> が条件を満たします。このとき <code>(a, b, c) = (200, 375, 425)</code> です。</p>
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
                return {
                    ok,
                    message: ok ? '正解です！ (200, 375, 425) が条件を満たします。' : '三平方の定理と和が 1000 になる条件を再確認してください。',
                };
            },
            hints: [
                'Euclid の公式 <code>a = m^2 - n^2</code>, <code>b = 2mn</code>, <code>c = m^2 + n^2</code> を利用しましょう。',
                '<code>2m(m + n) = 1000</code> を満たす <code>m, n</code> を探すと候補が絞れます。',
                '互いに素で奇偶が異なる <code>m, n</code> を選ぶと原始ピタゴラス数になります。',
            ],
        },
        {
            id: 'p4',
            title: 'The 10,001st prime',
            difficulty: 'Medium',
            statement: `10,001 番目の素数を求めてください。`,
            explanation: `
                <p>素数判定は平方根までの試し割りで十分です。また 6k ± 1 の形の整数だけを候補にすると効率的に探索できます。</p>
                <p>この方法で素数を数えていくと 10,001 個目の素数は <code>104743</code> になります。</p>
            `,
            inputs: [
                { id: 'ans', label: 'Answer (整数)', type: 'number', placeholder: 'e.g. 104743' },
            ],
            check: (answers) => {
                const ans = utils.parseNum(answers.ans);
                const correct = utils.nthPrime(10001);
                const ok = utils.eqNum(ans, correct);
                return {
                    ok,
                    message: ok ? '正解です！' : '10,001 番目の素数をもう一度計算してみましょう。',
                };
            },
            hints: [
                '平方根まで試し割りを行えば十分です。',
                '6k ± 1 の形に絞って候補を列挙すると高速化できます。',
            ],
        },
    ];

    const groups = [
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

    return { utils, problems, groups };
}));
