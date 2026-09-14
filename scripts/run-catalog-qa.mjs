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
  await page.goto(
    `${process.env.JOURNEY_QA_URL || 'http://127.0.0.1:5173'}/validation.html`,
  );
  await page
    .getByRole('button', { name: 'Run catalog checks', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('#status')?.textContent?.startsWith('Complete:'),
    {},
    { timeout: 240000 },
  );
  const report = await page.evaluate(() => ({
    status: document.querySelector('#status')?.textContent,
    results: JSON.parse(document.body.dataset.results || '[]'),
    audio: JSON.parse(document.body.dataset.audioCheck || '{}'),
    native: JSON.parse(document.body.dataset.nativeChecks || '[]'),
  }));
  await writeFile(
    '/tmp/cyber-catalog-qa.json',
    JSON.stringify(report, null, 2),
  );
  const failures = report.results.filter((r) => r.result === 'FAIL');
  console.log(
    JSON.stringify({
      status: report.status,
      failures,
      audio: report.audio,
      native: report.native,
    }),
  );
  if (
    failures.length ||
    report.audio.result === 'FAIL' ||
    report.native.some((r) => r.error)
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
