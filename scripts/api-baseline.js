/**
 * Commons API Performance Baseline Benchmark (Stage 2)
 *
 * Measures sequential latency (warm-up + 50 iterations) across:
 * 1. Simple public reads (p95 target < 500ms)
 * 2. Complex / DB-heavy reads (p95 target < 800ms)
 * 3. Write operations (p95 target < 1,000ms)
 *
 * Runs with Node.js built-in APIs (fetch, performance).
 * Usage: node scripts/api-baseline.js [--baseUrl=http://localhost:5000]
 */

const BASE_URL = process.env.BASE_URL || 
  process.argv.find(arg => arg.startsWith('--baseUrl='))?.split('=')[1] || 
  'http://localhost:5000';

const WARMUP_COUNT = 5;
const MEASURE_COUNT = 50;

// Category p95 thresholds in milliseconds
const THRESHOLDS = {
  'Simple Public Read': 500,
  'Complex DB Read': 800,
  'Write Operation': 1000,
};

function calculateStats(samples) {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  
  // Percentiles
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const p95 = sorted[p95Index];

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p95: Number(p95.toFixed(2)),
  };
}

async function runBenchmark() {
  console.log('='.repeat(80));
  console.log(` Commons API Performance Baseline Benchmark`);
  console.log(` Target Server: ${BASE_URL}`);
  console.log(` Warm-up: ${WARMUP_COUNT} requests | Measured: ${MEASURE_COUNT} requests (Sequential)`);
  console.log('='.repeat(80));

  // 1. Setup Auth and Session State
  console.log('\n[1/3] Initializing Session and Authenticated Runner...');
  const csrfRes = await fetch(`${BASE_URL}/auth/csrf`);
  if (!csrfRes.ok) {
    throw new Error(`Failed to obtain CSRF token from ${BASE_URL}/auth/csrf (Status: ${csrfRes.status})`);
  }
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson.data.csrfToken;
  const sessionCookies = csrfRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  // Login or Register benchmark user
  let loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
      'cookie': sessionCookies
    },
    body: JSON.stringify({ email: 'benchmark_runner@test.com', password: 'BenchmarkPassword123!' })
  });

  let authCookies = '';
  if (loginRes.ok) {
    authCookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    console.log('  ✓ Authenticated as existing benchmark_runner@test.com');
  } else {
    // Attempt registration if not present
    const signupRes = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        'cookie': sessionCookies
      },
      body: JSON.stringify({
        email: 'benchmark_runner@test.com',
        password: 'BenchmarkPassword123!',
        displayName: 'Benchmark Runner',
        username: 'bench_runner',
        role: 'member'
      })
    });
    if (!signupRes.ok) {
      throw new Error(`Failed to login or register benchmark runner: ${signupRes.status}`);
    }
    authCookies = signupRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    console.log('  ✓ Created and authenticated new benchmark_runner@test.com');
  }

  const combinedAuthCookies = [sessionCookies, authCookies].filter(Boolean).join('; ');

  // 2. Define Endpoints to Benchmark
  console.log('\n[2/3] Preparing 15 Verified Endpoints across 3 Categories...');

  const endpoints = [
    // --- Category 1: Simple Public Reads (Target < 500ms) ---
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/health',
      requestFn: () => fetch(`${BASE_URL}/health`),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.status === 'ok',
    },
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/ready',
      requestFn: () => fetch(`${BASE_URL}/ready`),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.status === 'ready',
    },
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/auth/csrf',
      requestFn: () => fetch(`${BASE_URL}/auth/csrf`),
      validateFn: (status, body) => status === 200 && body.success === true && typeof body.data?.csrfToken === 'string',
    },
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/pages',
      requestFn: () => fetch(`${BASE_URL}/pages`),
      validateFn: (status, body) => status === 200 && body.success === true && Array.isArray(body.data?.pages),
    },
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/users/commonsdf799f',
      requestFn: () => fetch(`${BASE_URL}/users/commonsdf799f`),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.user?.username === 'commonsdf799f',
    },

    // --- Category 2: Complex or Database-Heavy Reads (Target < 800ms) ---
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/pages/commons',
      requestFn: () => fetch(`${BASE_URL}/pages/commons`),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.page?.pageSlug === 'commons',
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/posts/creator?pageSlug=commons',
      requestFn: () => fetch(`${BASE_URL}/posts/creator?pageSlug=commons`),
      validateFn: (status, body) => status === 200 && body.success === true && Array.isArray(body.data?.posts),
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/posts/6acf7f60d559dd44440fb088',
      requestFn: () => fetch(`${BASE_URL}/posts/6acf7f60d559dd44440fb088`),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.post?._id === '6acf7f60d559dd44440fb088',
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/tiers/creator/6a6b59e2987cb5a57a940db8',
      requestFn: () => fetch(`${BASE_URL}/tiers/creator/6a6b59e2987cb5a57a940db8`),
      validateFn: (status, body) => status === 200 && body.success === true && Array.isArray(body.data?.plans),
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/auth/me',
      requestFn: () => fetch(`${BASE_URL}/auth/me`, {
        headers: { 'cookie': combinedAuthCookies }
      }),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.user?.email === 'benchmark_runner@test.com',
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/notifications',
      requestFn: () => fetch(`${BASE_URL}/notifications`, {
        headers: { 'cookie': combinedAuthCookies }
      }),
      validateFn: (status, body) => status === 200 && body.success === true && Array.isArray(body.data?.notifications),
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/notifications/unread-count',
      requestFn: () => fetch(`${BASE_URL}/notifications/unread-count`, {
        headers: { 'cookie': combinedAuthCookies }
      }),
      validateFn: (status, body) => status === 200 && body.success === true && typeof body.data?.count === 'number',
    },

    // --- Category 3: Database Write Operations (Target < 1,000ms) ---
    {
      category: 'Write Operation',
      method: 'POST',
      route: '/auth/check-email',
      requestFn: () => fetch(`${BASE_URL}/auth/check-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          'cookie': sessionCookies
        },
        body: JSON.stringify({ email: 'benchmark_runner@test.com' })
      }),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.exists === true,
    },
    {
      category: 'Write Operation',
      method: 'POST',
      route: '/posts/6acf7f60d559dd44440fb088/view',
      requestFn: () => fetch(`${BASE_URL}/posts/6acf7f60d559dd44440fb088/view`, {
        method: 'POST'
      }),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.recorded === true,
    },
    {
      category: 'Write Operation',
      method: 'PUT',
      route: '/users/me',
      requestFn: (seq) => fetch(`${BASE_URL}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          'cookie': combinedAuthCookies
        },
        body: JSON.stringify({
          displayName: 'Benchmark Runner',
          bio: `Active benchmark test bio seq=${seq} timestamp=${Date.now()}`
        })
      }),
      validateFn: (status, body) => status === 200 && body.success === true && body.data?.user?.displayName === 'Benchmark Runner',
    },
  ];

  // 3. Execute Benchmark Loops
  console.log('\n[3/3] Executing Warm-up and Sequential Measurements...');
  const results = [];

  for (let idx = 0; idx < endpoints.length; idx++) {
    const ep = endpoints[idx];
    const label = `${ep.method} ${ep.route}`;
    process.stdout.write(`  [${String(idx + 1).padStart(2, ' ')}/${endpoints.length}] ${label.padEnd(46)} `);

    // Warm-up requests
    for (let w = 0; w < WARMUP_COUNT; w++) {
      try {
        const res = await ep.requestFn(w);
        await res.text();
      } catch (err) {
        // Discard warm-up errors
      }
    }

    // Measured requests
    const durations = [];
    let successCount = 0;
    let failureCount = 0;
    const statusCodes = new Map();

    for (let m = 0; m < MEASURE_COUNT; m++) {
      const startTime = performance.now();
      let status = 0;
      let valid = false;

      try {
        const res = await ep.requestFn(m);
        status = res.status;
        statusCodes.set(status, (statusCodes.get(status) || 0) + 1);

        const rawText = await res.text();
        const duration = performance.now() - startTime;
        durations.push(duration);

        let parsed = null;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = null;
        }

        valid = ep.validateFn ? ep.validateFn(status, parsed) : status === 200;
        if (valid) {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (err) {
        const duration = performance.now() - startTime;
        durations.push(duration);
        failureCount++;
        statusCodes.set('NETWORK_ERROR', (statusCodes.get('NETWORK_ERROR') || 0) + 1);
      }
    }

    const stats = calculateStats(durations);
    const target = THRESHOLDS[ep.category];
    const isPass = stats.p95 <= target && failureCount === 0;

    results.push({
      ...ep,
      stats,
      successCount,
      failureCount,
      target,
      isPass,
      statusCodes: Object.fromEntries(statusCodes.entries()),
    });

    const statusBadge = isPass ? 'PASS' : 'MISS';
    console.log(`p50: ${String(stats.p50).padStart(6)}ms | p95: ${String(stats.p95).padStart(6)}ms | avg: ${String(stats.avg).padStart(6)}ms [${statusBadge}]`);
  }

  // 4. Output Summary Table
  console.log('\n' + '='.repeat(110));
  console.log(' BENCHMARK SUMMARY RESULTS TABLE');
  console.log('='.repeat(110));

  const headers = ['Method & Route', 'Category', 'OK/Total', 'Min', 'Avg', 'p50', 'p95', 'Max', 'Target', 'Result'];
  console.log(
    '| ' +
    headers[0].padEnd(42) + ' | ' +
    headers[1].padEnd(19) + ' | ' +
    headers[2].padEnd(8) + ' | ' +
    headers[3].padStart(6) + ' | ' +
    headers[4].padStart(7) + ' | ' +
    headers[5].padStart(7) + ' | ' +
    headers[6].padStart(7) + ' | ' +
    headers[7].padStart(7) + ' | ' +
    headers[8].padStart(6) + ' | ' +
    headers[9].padEnd(6) + ' |'
  );
  console.log('|' + '-'.repeat(44) + '|' + '-'.repeat(21) + '|' + '-'.repeat(10) + '|' + '-'.repeat(8) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(8) + '|' + '-'.repeat(8) + '|');

  for (const r of results) {
    const routeStr = `${r.method} ${r.route}`;
    const okStr = `${r.successCount}/${MEASURE_COUNT}`;
    const minStr = `${r.stats.min}ms`;
    const avgStr = `${r.stats.avg}ms`;
    const p50Str = `${r.stats.p50}ms`;
    const p95Str = `${r.stats.p95}ms`;
    const maxStr = `${r.stats.max}ms`;
    const targetStr = `<${r.target}ms`;
    const resultStr = r.isPass ? 'PASS' : 'MISS';

    console.log(
      '| ' +
      routeStr.padEnd(42) + ' | ' +
      r.category.padEnd(19) + ' | ' +
      okStr.padEnd(8) + ' | ' +
      minStr.padStart(6) + ' | ' +
      avgStr.padStart(7) + ' | ' +
      p50Str.padStart(7) + ' | ' +
      p95Str.padStart(7) + ' | ' +
      maxStr.padStart(7) + ' | ' +
      targetStr.padStart(6) + ' | ' +
      resultStr.padEnd(6) + ' |'
    );
  }
  console.log('='.repeat(110));

  return results;
}

runBenchmark().catch((err) => {
  console.error('\n❌ Fatal benchmark error:', err);
  process.exit(1);
});
