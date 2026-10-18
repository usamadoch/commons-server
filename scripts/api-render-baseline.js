/**
 * Commons Stage 4: Render Production Read-Only Baseline Benchmark
 *
 * Measures sequential latency (5 warm-up + 50 measured requests) against
 * the deployed Render backend (https://api.commons.pk) across verified safe read endpoints.
 *
 * NOTE: Strictly read-only to avoid modifying production data or creating junk records.
 */

const BASE_URL = process.env.BASE_URL || 'https://api.commons.pk';
const WARMUP_COUNT = 5;
const MEASURE_COUNT = 50;

const THRESHOLDS = {
  'Simple Public Read': 500,
  'Complex DB Read': 800,
};

function calculateStats(samples) {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  const p99 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)];

  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    p50: Number(p50.toFixed(2)),
    p90: Number(p90.toFixed(2)),
    p95: Number(p95.toFixed(2)),
    p99: Number(p99.toFixed(2)),
  };
}

async function runRenderBaseline() {
  console.log('='.repeat(80));
  console.log(` Render Production API Baseline Benchmark (Safe Read-Only)`);
  console.log(` Target Server: ${BASE_URL}`);
  console.log(` Warm-up: ${WARMUP_COUNT} requests | Measured: ${MEASURE_COUNT} requests (Sequential)`);
  console.log('='.repeat(80));

  const endpoints = [
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/health',
      requestFn: () => fetch(`${BASE_URL}/health`),
      validateFn: (status, body) => status === 200 && body.success === true,
    },
    {
      category: 'Simple Public Read',
      method: 'GET',
      route: '/ready',
      requestFn: () => fetch(`${BASE_URL}/ready`),
      validateFn: (status, body) => status === 200 && body.success === true,
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
      route: '/posts/6ab670e11d78868df779cf94',
      requestFn: () => fetch(`${BASE_URL}/posts/6ab670e11d78868df779cf94`),
      validateFn: (status, body) => status === 200 && body.success === true && Boolean(body.data?.post),
    },
    {
      category: 'Complex DB Read',
      method: 'GET',
      route: '/tiers/creator/6a4ab792301861fbab5f22c8',
      requestFn: () => fetch(`${BASE_URL}/tiers/creator/6a4ab792301861fbab5f22c8`),
      validateFn: (status, body) => status === 200 && body.success === true && Array.isArray(body.data?.plans),
    },
  ];

  const results = [];

  for (let idx = 0; idx < endpoints.length; idx++) {
    const ep = endpoints[idx];
    const label = `${ep.method} ${ep.route}`;
    process.stdout.write(`  [${String(idx + 1).padStart(2, ' ')}/${endpoints.length}] ${label.padEnd(46)} `);

    // Warm-up requests
    for (let w = 0; w < WARMUP_COUNT; w++) {
      try {
        const res = await ep.requestFn();
        await res.text();
      } catch {
        // Discard warm-up errors
      }
    }

    const durations = [];
    let successCount = 0;
    let failureCount = 0;
    const statusCodes = new Map();

    for (let m = 0; m < MEASURE_COUNT; m++) {
      const startTime = performance.now();
      let status = 0;
      let valid = false;

      try {
        const res = await ep.requestFn();
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
      } catch {
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
    console.log(`p50: ${String(stats.p50).padStart(6)}ms | p95: ${String(stats.p95).padStart(6)}ms | p99: ${String(stats.p99).padStart(6)}ms | avg: ${String(stats.avg).padStart(6)}ms [${statusBadge}]`);
  }

  // Summary Table
  console.log('\n' + '='.repeat(120));
  console.log(' RENDER PRODUCTION API BASELINE RESULTS TABLE');
  console.log('='.repeat(120));

  const headers = ['Method & Route', 'Category', 'OK/Total', 'Min', 'Avg', 'p50', 'p90', 'p95', 'p99', 'Max', 'Target', 'Result'];
  console.log(
    '| ' +
    headers[0].padEnd(42) + ' | ' +
    headers[1].padEnd(19) + ' | ' +
    headers[2].padEnd(8) + ' | ' +
    headers[3].padStart(7) + ' | ' +
    headers[4].padStart(7) + ' | ' +
    headers[5].padStart(7) + ' | ' +
    headers[6].padStart(7) + ' | ' +
    headers[7].padStart(7) + ' | ' +
    headers[8].padStart(7) + ' | ' +
    headers[9].padStart(7) + ' | ' +
    headers[10].padStart(6) + ' | ' +
    headers[11].padEnd(6) + ' |'
  );
  console.log('|' + '-'.repeat(44) + '|' + '-'.repeat(21) + '|' + '-'.repeat(10) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(9) + '|' + '-'.repeat(8) + '|' + '-'.repeat(8) + '|');

  for (const r of results) {
    const routeStr = `${r.method} ${r.route}`;
    const okStr = `${r.successCount}/${MEASURE_COUNT}`;
    const minStr = `${r.stats.min}ms`;
    const avgStr = `${r.stats.avg}ms`;
    const p50Str = `${r.stats.p50}ms`;
    const p90Str = `${r.stats.p90}ms`;
    const p95Str = `${r.stats.p95}ms`;
    const p99Str = `${r.stats.p99}ms`;
    const maxStr = `${r.stats.max}ms`;
    const targetStr = `<${r.target}ms`;
    const resultStr = r.isPass ? 'PASS' : 'MISS';

    console.log(
      '| ' +
      routeStr.padEnd(42) + ' | ' +
      r.category.padEnd(19) + ' | ' +
      okStr.padEnd(8) + ' | ' +
      minStr.padStart(7) + ' | ' +
      avgStr.padStart(7) + ' | ' +
      p50Str.padStart(7) + ' | ' +
      p90Str.padStart(7) + ' | ' +
      p95Str.padStart(7) + ' | ' +
      p99Str.padStart(7) + ' | ' +
      maxStr.padStart(7) + ' | ' +
      targetStr.padStart(6) + ' | ' +
      resultStr.padEnd(6) + ' |'
    );
  }
  console.log('='.repeat(120));

  return results;
}

runRenderBaseline().catch(err => {
  console.error('\n❌ Fatal Render Baseline Error:', err);
  process.exit(1);
});
