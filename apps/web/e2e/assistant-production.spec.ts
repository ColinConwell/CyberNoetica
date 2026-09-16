import { test, expect } from '@playwright/test';
test('production assistant starts off, has no server keys, and requires BYOK', async ({
  page,
}) => {
  test.skip(
    process.env.STUDIO_PROD_QA !== '1',
    'Built Express server validation only',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let configRequests = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/assistant/config')) configRequests++;
  });
  await page.goto('/?viz=orbital&mute&debug');
  await expect(page).toHaveTitle(/Cybern(?:oe|œ|ɶ)tica/i);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '✦ AI Studio', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '◈ Developer', exact: true }),
  ).toHaveCount(0);
  expect(configRequests).toBe(0);
  expect(await page.evaluate(() => window.__cybernoetica!.store.getState().ui.controlsVisibility)).toBe('auto');
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
  await expect(panel.getByLabel('API key', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const config = await (await fetch('/api/assistant/config')).json();
    const post = (path: string, body: unknown) =>
      fetch('/api/assistant/' + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Enabled': 'true',
        },
        body: JSON.stringify(body),
      });
    return {
      config,
      source: (await post('source', { target: 'orbital' })).status,
      test: (await post('test', { suite: 'studio' })).status,
      turn: (
        await post('turn', {
          provider: 'openai',
          model: 'gpt-6-astra',
          mode: 'debug',
          context: {},
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).status,
    };
  });
  expect(result.config.local).toBe(false);
  expect(
    result.config.providers.every(
      (p: { localKeyAvailable: boolean }) => !p.localKeyAvailable,
    ),
  ).toBe(true);
  expect(result.source).toBe(404);
  expect(result.test).toBe(404);
  expect(result.turn).toBe(401);
  expect(errors).toEqual([]);
});
