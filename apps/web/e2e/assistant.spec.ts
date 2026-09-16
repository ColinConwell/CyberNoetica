import { test, expect, type Page } from '@playwright/test';
const recipe = {
  version: 1,
  name: 'Tidal rose',
  description: 'Interlaced violet ribbons with audio-driven breathing.',
  layers: [
    {
      shape: 'rose',
      marks: 'line',
      count: 256,
      radius: 2,
      frequencyX: 3,
      frequencyY: 2,
      frequencyZ: 1,
      phase: 0,
      twist: 1,
      speed: 0.2,
      hue: 0.7,
      opacity: 0.6,
      bass: 1,
      treble: 0.2,
    },
  ],
};
const tool = (operation: string, payload: unknown) => ({
  text: '',
  calls: [
    {
      id: 'call_1',
      name: 'studio_tool',
      arguments: JSON.stringify({
        operation,
        payload: JSON.stringify(payload),
      }),
    },
  ],
});
async function open(page: Page, mockConfig = true) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (mockConfig)
    await page.route('**/api/assistant/config', (route) =>
      route.fulfill({
        json: {
          local: false,
          providers: [
            {
              id: 'openai',
              label: 'OpenAI · Astra',
              model: 'gpt-6-astra',
              localKeyAvailable: false,
            },
          ],
          maxRounds: 6,
        },
      }),
    );
  await page.goto('/?viz=orbital&mute');
  await expect(page).toHaveTitle(/Cybern(?:oe|œ|ɶ)tica/i);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.vizManager?.getActiveType()),
    )
    .toBe('orbital');
  await page.getByRole('button', { name: '✦ AI Studio', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'AI Studio',
    exact: true,
  });
  await expect(
    panel.getByRole('checkbox', { name: 'Enable AI assistants' }),
  ).not.toBeChecked();
  await panel.getByRole('checkbox', { name: 'Enable AI assistants' }).check();
  await expect(panel.getByRole('status')).toContainText('Ready');
  return { panel, errors };
}
test('BYOK stays in memory; edits require Apply and can be undone', async ({
  page,
}, info) => {
  const { panel, errors } = await open(page);
  let turns = 0;
  await page.route('**/api/assistant/turn', async (route) => {
    turns++;
    expect(route.request().headers().authorization).toBe(
      'Bearer test-session-only',
    );
    const body = route.request().postDataJSON();
    expect(JSON.stringify(body)).not.toContain('test-session-only');
    await route.fulfill({
      json:
        turns === 1
          ? tool('set_visual_params', {
              type: 'orbital',
              params: { glowMultiplier: 0.5 },
            })
          : { text: 'Glow reduced.', calls: [] },
    });
  });
  const before = await page.evaluate(
    () =>
      window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.()
        .glowMultiplier,
  );
  await panel.getByLabel('API key', { exact: true }).fill('test-session-only');
  await panel.getByLabel('Message to assistant').fill('Reduce glow');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Apply proposed edit' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.()
          .glowMultiplier,
    ),
  ).toBe(before);
  await panel.getByRole('button', { name: 'Apply proposed edit' }).click();
  await expect(panel.getByRole('status')).toContainText('Complete');
  expect(
    await page.evaluate(
      () =>
        window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.()
          .glowMultiplier,
    ),
  ).toBe(0.5);
  await panel.getByRole('button', { name: 'Undo last live edit' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.()
            .glowMultiplier,
      ),
    )
    .toBe(before);
  await panel.getByLabel('API key', { exact: true }).fill('');
  await page.screenshot({
    path: `/tmp/cybernoetica-assistant-${info.project.name}.png`,
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain('test-session-only');
  await panel.getByRole('checkbox', { name: 'Enable AI assistants' }).uncheck();
  await panel.getByRole('checkbox', { name: 'Enable AI assistants' }).check();
  await expect(panel.getByLabel('API key', { exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});
test('stale proposals and cancelled runs cannot overwrite manual choices', async ({
  page,
}) => {
  const { panel, errors } = await open(page);
  let turns = 0;
  await page.route('**/api/assistant/turn', (route) => {
    turns++;
    return route.fulfill({
      json:
        turns % 2
          ? tool('set_visual_params', {
              type: 'orbital',
              params: { glowMultiplier: 0.5 },
            })
          : { text: 'No change applied.', calls: [] },
    });
  });
  const submit = async () => {
    await panel.getByLabel('Message to assistant').fill('Reduce glow');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Apply proposed edit' }),
    ).toBeVisible();
  };
  await submit();
  await page.evaluate(() =>
    window.__cybernoetica?.vizManager
      ?.getActive()
      ?.setUserParam('glowMultiplier', 1.3),
  );
  await panel.getByRole('button', { name: 'Apply proposed edit' }).click();
  await expect(panel.getByRole('log')).toContainText('Configuration changed');
  await expect(panel.getByRole('status')).toContainText('Complete');
  await submit();
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Apply proposed edit' }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.()
          .glowMultiplier,
    ),
  ).toBe(1.3);
  expect(errors).toEqual([]);
});
test('generated recipes render, save, reload, and stay in the visualizer picker', async ({
  page,
}) => {
  const { panel, errors } = await open(page);
  let turns = 0;
  await page.route('**/api/assistant/turn', (route) =>
    route.fulfill({
      json:
        ++turns === 1
          ? tool('create_visualizer', { recipe })
          : { text: 'Tidal rose is running.', calls: [] },
    }),
  );
  await panel.getByLabel('Mode', { exact: true }).selectOption('create');
  await panel.getByLabel('Allow live edits', { exact: true }).check();
  await panel.getByLabel('Message to assistant').fill('Create a violet rose');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Complete');
  const id = await page.evaluate(() =>
    window.__cybernoetica?.vizManager?.getActiveType(),
  );
  expect(id).toMatch(/^studio-/);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__cybernoetica?.scene.getRenderer().info.render.calls,
      ),
    )
    .toBeGreaterThan(0);
  await panel.getByText('Your creations', { exact: true }).click();
  await panel
    .getByRole('button', { name: 'Save locally', exact: true })
    .click();
  await page.reload();
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByText('Studio creations · 1', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Tidal rose', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Tidal rose', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.vizManager?.getActiveType()),
    )
    .toBe(id);
  expect(errors).toEqual([]);
});
test('Astra live tool loop creates and inspects a new visualizer', async ({
  page,
}, info) => {
  test.skip(
    process.env.STUDIO_LIVE_QA !== '1' || info.project.name !== 'desktop',
    'Explicit live-provider QA only',
  );
  test.setTimeout(240000);
  const { panel, errors } = await open(page, false);
  await panel.getByLabel('Mode', { exact: true }).selectOption('create');
  await panel.getByLabel('Allow live edits', { exact: true }).check();
  await panel
    .getByLabel('Message to assistant')
    .fill(
      'Create a new visualizer called Silver Tide with two generous layers with radius 3, a violet rose and cyan helix, restrained motion, roughly 256 samples each. Use create_visualizer then validate_controls. Finish with one sentence.',
    );
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Complete', {
    timeout: 180000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.vizManager?.getActiveType()),
    )
    .toMatch(/^studio-/);
  await expect(panel.getByRole('log')).toContainText('"passed":true');
  await panel.getByLabel('Mode', { exact: true }).selectOption('debug');
  await panel
    .getByLabel('Message to assistant')
    .fill(
      'Inspect the running visualizer, then set its Motion speed control to exactly 0.5. Do not change any other control. Finish with one sentence.',
    );
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Complete', {
    timeout: 120000,
  });
  expect(
    await page.evaluate(
      () =>
        window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.().speed,
    ),
  ).toBe(0.5);
  await panel.getByRole('button', { name: 'Undo last live edit' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__cybernoetica?.vizManager?.getActive()?.getUserParams?.()
            .speed,
      ),
    )
    .toBe(1);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: '/tmp/cybernoetica-astra-creation.png' });
  expect(errors).toEqual([]);
});

test('agent tools look up local code, execute a fixed test suite and export a handoff', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Server tool validation once');
  const { panel, errors } = await open(page);
  let turns = 0;
  await page.route('**/api/assistant/turn', (route) => {
    const a = tool('lookup_source', {
        target: 'orbital',
        key: 'glowMultiplier',
      }),
      b = tool('run_tests', { suite: 'studio' });
    b.calls[0].id = 'call_2';
    const response =
      ++turns === 1
        ? {
            text: 'Checking the source and fixed tests.',
            calls: [...a.calls, ...b.calls],
          }
        : turns === 2
          ? tool('record_handoff', {
              note: 'Preserve the recorded glow as a proposed default.',
            })
          : { text: 'Handoff ready.', calls: [] };
    return route.fulfill({ json: response });
  });
  await panel
    .getByLabel('Message to assistant')
    .fill('Inspect, test and record');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Complete', {
    timeout: 45000,
  });
  await expect(panel.getByRole('log')).toContainText('orbital/v01-alpha.ts');
  await expect(panel.getByRole('log')).toContainText('"passed":true');
  const downloadPromise = page.waitForEvent('download');
  await panel
    .getByRole('button', { name: 'Download handoff', exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('cybernoetica-agent-handoff.md');
  expect(errors).toEqual([]);
});
