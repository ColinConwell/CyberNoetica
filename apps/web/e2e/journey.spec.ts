import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.goto('/?viz=orbital&audio=soundscape&mute');
  await expect(
    page.getByRole('button', { name: 'Visual', exact: true }),
  ).toBeVisible();
});
test('cluster search, keyboard focus, and existing Individual selection', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Individual', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('searchbox', { name: 'Search visualizers' })
    .fill('no such visualizer');
  await expect(
    page.getByText('No visualizers match this search.'),
  ).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Search visualizers' })
    .fill('Torus Knot');
  await page.getByRole('button', { name: 'Torus Knot', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.vizManager?.getActiveType()),
    )
    .toBe('torusknot');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Visual', exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('live Journey preserves route editing and presentation changes', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Orbital', {
    timeout: 20000,
  });
  await expect(page.getByTestId('journey-stop')).toHaveCount(6);
  await page
    .getByRole('combobox', { name: 'Presentation', exact: true })
    .selectOption('unified');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText(
    'transitioning',
    { timeout: 20000 },
  );
  await page
    .getByRole('button', { name: 'Pause Journey', exact: true })
    .click();
  await expect(page.getByTestId('journey-status')).toContainText('paused');
  const before = await page
    .getByRole('progressbar', { name: 'Transition progress' })
    .getAttribute('value');
  await page
    .getByRole('combobox', { name: 'Presentation', exact: true })
    .selectOption('character');
  expect(
    await page
      .getByRole('progressbar', { name: 'Transition progress' })
      .getAttribute('value'),
  ).toBe(before);
  const hold = page
    .getByRole('spinbutton', { name: 'Hold (s)', exact: true })
    .first();
  await hold.fill('12');
  await hold.press('Tab');
  await expect(hold).toHaveValue('12');
  await page.screenshot({
    path: `/tmp/cyber-journey-${info.project.name}.png`,
  });
  await page.getByRole('button', { name: 'Individual', exact: true }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Search visualizers' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('route import reports invalid data without replacing the current route', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-stop')).toHaveCount(6, {
    timeout: 20000,
  });
  await page.getByText('Save and load', { exact: true }).click();
  await page.getByLabel('Import Journey file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99,"stops":[]}'),
  });
  await expect(page.getByText(/Journey requires version 1/)).toBeVisible();
  await expect(page.getByTestId('journey-stop')).toHaveCount(6);
});
test('offline synthesis uses the real engine and audio-clock automation', async ({
  page,
}) => {
  await page.goto('/journey-validation.html');
  await page.waitForFunction(() => Boolean(window.__journeyQA));
  const results = await page.evaluate(() => window.__journeyQA!.synthesis());
  expect(results).toHaveLength(7);
  expect(results[0].rms).toBeGreaterThan(0.005);
});
test('composition disclosure, touch reorder alternative, and route export', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Orbital', {
    timeout: 20000,
  });
  await page
    .getByRole('button', { name: 'Pause Journey', exact: true })
    .click();
  const first = page.getByTestId('journey-stop').first();
  await first.locator('summary').first().click();
  await first
    .getByRole('button', { name: 'Add contributor', exact: true })
    .click();
  await expect(first.getByText('Compose · 2 contributors')).toBeVisible();
  await first
    .getByRole('combobox', { name: 'Composition', exact: true })
    .selectOption('blend');
  await first
    .getByRole('button', { name: 'Add contributor', exact: true })
    .click();
  await expect(
    first.getByRole('button', { name: 'Add contributor', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Move stop 1 down', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Move stop 2 up', exact: true }),
  ).toBeFocused();
  await page.getByText('Save and load', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export Journey', exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    'cybernoetica-journey.json',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('advanced Soundscape controls remain progressively disclosed', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await page.getByText('Sound design', { exact: true }).click();
  await page.getByText('Voices', { exact: true }).click();
  await page.getByText('Voice 1', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Voice 1 waveform', exact: true })
    .selectOption('triangle');
  const frequency = page.getByRole('spinbutton', {
    name: 'Voice 1 Frequency (Hz)',
    exact: true,
  });
  await frequency.fill('110');
  await frequency.press('Tab');
  await expect(frequency).toHaveValue('110');
  await page.getByText('Envelopes', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Envelope trigger', exact: true })
    .selectOption('tempo');
  await page.getByText('Delay and output', { exact: true }).click();
  const wet = page.getByRole('spinbutton', { name: 'Wet / dry', exact: true });
  await wet.fill('.3');
  await wet.press('Tab');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
function pulseWave(): Buffer {
  const rate = 8000,
    duration = 12,
    count = rate * duration,
    bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36 + count * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const age = (i % (rate / 2)) / rate,
      value =
        Math.sin((2 * Math.PI * 220 * i) / rate) * Math.exp(-age * 40) * 0.5;
    bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  return bytes;
}
test('local file timeline, cue edits, seek reconciliation, and muted analysis', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Load Local Audio', exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'journey-pulses.wav',
    mimeType: 'audio/wav',
    buffer: pulseWave(),
  });
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Orbital', {
    timeout: 20000,
  });
  await page
    .getByRole('button', { name: 'Pause Journey', exact: true })
    .click();
  await page.getByText('Track timeline', { exact: true }).click();
  await expect(
    page.getByRole('slider', { name: 'Track position', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Add cue here', exact: true }).click();
  const cue = page.getByRole('spinbutton', { name: 'Cue 1 (s)', exact: true });
  await cue.fill('7');
  await cue.press('Tab');
  await expect(cue).toHaveValue('7');
  await expect(
    page.getByRole('button', { name: 'Use estimated tempo', exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await page
    .getByRole('button', { name: 'Use estimated tempo', exact: true })
    .click();
  const seek = page.getByRole('slider', {
    name: 'Track position',
    exact: true,
  });
  await seek.fill('5');
  await seek.dispatchEvent('change');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__cybernoetica?.journey?.source.getTransport().position,
      ),
    )
    .toBeGreaterThanOrEqual(5);
  expect(
    await page.evaluate(() =>
      window.__cybernoetica!.journey!.analysis!.energy.some((v) => v > 0.01),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Remove cue 1', exact: true }).click();
  await expect(cue).toHaveCount(0);
});
test('context restoration rebuilds Journey and global pause freezes timing', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Orbital', {
    timeout: 20000,
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.journey?.state?.phase),
    )
    .toBe('paused');
  const elapsed = await page.evaluate(
    () => window.__cybernoetica!.journey!.state!.elapsed,
  );
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => window.__cybernoetica!.journey!.state!.elapsed),
  ).toBe(elapsed);
  await page.evaluate(async () => {
    const initial = window.__cybernoetica!.journey!.active;
    const r = window.__cybernoetica!.scene.getRenderer()!,
      extension = r.getContext().getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Missing context test extension');
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 100);
    const deadline = performance.now() + 15000;
    while (
      window.__cybernoetica!.journey!.active === initial ||
      !window.__cybernoetica!.journey!.active?.ready
    ) {
      if (performance.now() > deadline)
        throw new Error('Context did not rebuild Journey');
      await new Promise((r) => setTimeout(r, 20));
    }
  });
  await expect
    .poll(
      () => page.evaluate(() => window.__cybernoetica?.journey?.active?.ready),
      { timeout: 20000 },
    )
    .toBe(true);
});
test('No audio keeps autonomous Journey timing active', async ({ page }) => {
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await page.getByRole('button', { name: 'No audio', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Orbital', {
    timeout: 20000,
  });
  const start = await page.evaluate(
    () => window.__cybernoetica!.journey!.state!.elapsed,
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica!.journey!.state!.elapsed),
    )
    .toBeGreaterThan(start + 0.2);
});
