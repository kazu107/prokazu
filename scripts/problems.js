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
            difficulty: 'easy',
            statement: `1000 未満の自然数のうち、<code>3</code> または <code>5</code> の倍数の総和を求めてください。<br />Enter the total sum (an integer).`,
            explanation: `
                eaeee
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
            difficulty: 'basic',
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
            title: 'Cubed triplet for which a^3 + b^3 + c^3 = 107',
            difficulty: 'Hard',
            statement: `<code>a^3 + b^3 + c^3 = 107</code> を満たす <code>(a, b, c)</code> を求め、3 つの値を入力してください（整数）。ただし、<code>-60 <= a, b, c <= 60</code>の範囲とする。`,
            explanation: `
                a
            `,
            inputs: [
                { id: 'a', label: 'a', type: 'number', placeholder: 'e.g. 1' },
                { id: 'b', label: 'b', type: 'number', placeholder: 'e.g. 2' },
                { id: 'c', label: 'c', type: 'number', placeholder: 'e.g. 3' },
            ],
            check: (answers) => {
                const a = utils.parseNum(answers.a);
                const b = utils.parseNum(answers.b);
                const c = utils.parseNum(answers.c);
                const ok = (a * a * a + b * b * b + c * c * c === 107);
                return {
                    ok,
                    message: ok ? '正解です！' : (a === 1 && b === 2 && c === 3) ? '例をそのまま書かないで！' : '不正解です。',
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
            title: 'The 107107th prime',
            difficulty: 'hard',
            statement: `107107 番目の素数を求めてください。`,
            explanation: `
                s
            `,
            inputs: [
                { id: 'ans', label: 'Answer (整数)', type: 'number', placeholder: 'e.g. 57' },
            ],
            check: (answers) => {
                const ans = utils.parseNum(answers.ans);
                const ok = (ans === 1399709);
                return {
                    ok,
                    message: ok ? '正解です！' : (ans === 57) ? '例をそのまま書かないで！' : (ans === 1399691) ? 'それは107106番目の素数です！' : (ans === 1399721) ? 'それは107108番目の素数です！' : '不正解です。',
                };
            },
            hints: [
                '平方根まで試し割りを行えば十分です。',
                '6k ± 1 の形に絞って候補を列挙すると高速化できます。',
            ],
        },
        {
            id: 'p5',
            title: 'Sum of the divisors of 107107107',
            difficulty: 'medium',
            statement: `107107107 の約数の総和を求めてください。例えば、6の約数は1, 2, 3, 6 で、その総和は12です。`,
            explanation: `
                s
            `,
            inputs: [
                { id: 'ans', label: 'Answer (整数)', type: 'number', placeholder: 'e.g. 12' },
            ],
            check: (answers) => {
                const ans = utils.parseNum(answers.ans);
                const ok = (ans === 144144576);
                return {
                    ok,
                    message: ok ? '正解です！' : '不正解です。',
                };
            },
            hints: [
                '1から順に割れるか試してみましょう。',
                '整数Nがxで割り切れるなら、N/xも約数です。この性質を利用すれば高速化できます。',
            ],
        },
    ];

    const groups = [
        {
            id: 'basic',
            title: 'basic',
            defaultOpen: true,
            problemIds: ['p2'],
        },
        {
            id: 'easy',
            title: 'easy',
            problemIds: ['p1'],
        },
        {
            id: 'medium',
            title: 'medium',
            problemIds: ['p3', 'p5'],
        },
        {
            id: 'hard',
            title: 'hard',
            problemIds: ['p4'],
        },
        {
            id: 'insane',
            title: 'insane',
            problemIds: [],
        },
        {
            id: 'all-set',
            title: '全問題セット',
            includeAll: true,
        },
    ];

    return { utils, problems, groups };
}));
