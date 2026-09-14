import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(
    `${process.env.JOURNEY_QA_URL || 'http://127.0.0.1:5173'}/journey-validation.html`,
  );
  await page.waitForFunction(() => Boolean(window.__journeyQA));
  const options = process.argv.includes('--full')
    ? {}
    : {
        types: ['orbital', 'lissajous', 'torusknot', 'geodesic-beta'],
        fixtures: ['tones'],
        frames: 40,
      };
  if (
    process.argv.includes('--endurance') ||
    process.argv.includes('--benchmark')
  ) {
    const result = await page.evaluate(
      async (opts) =>
        opts.endurance
          ? window.__journeyQA.endurance()
          : window.__journeyQA.benchmark(opts.samples, opts.style),
      {
        endurance: process.argv.includes('--endurance'),
        samples: process.argv.includes('--high') ? 4096 : 2048,
        style: process.argv.includes('--unified') ? 'unified' : 'character',
      },
    );
    await writeFile(
      '/tmp/cyber-journey-' +
        (process.argv.includes('--endurance')
          ? 'endurance'
          : process.argv.includes('--unified')
            ? 'benchmark-unified'
            : 'benchmark-character') +
        '.json',
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ result, errors }));
    if (errors.length) process.exitCode = 1;
  } else {
    const results = await page.evaluate(
      (options) => window.__journeyQA.run(options),
      options,
    );
    const failures = results.filter(
      (r) => r.error || r.remainingGeometries || r.remainingTextures,
    );
    const report = { results, errors };
    await writeFile(
      '/tmp/cyber-journey-matrix.json',
      JSON.stringify(report, null, 2),
    );
    await page.screenshot({ path: '/tmp/cyber-journey-matrix.png' });
    console.log(
      JSON.stringify({
        cases: results.length,
        failures,
        errors,
        evidence: '/tmp/cyber-journey-matrix.json',
      }),
    );
    if (failures.length || errors.length) process.exitCode = 1;
  }
} finally {
  await browser.close();
}
