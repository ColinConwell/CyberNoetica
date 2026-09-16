import { test, expect } from '@playwright/test';

test('developer controls, annotation and source handoff', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', message => { if(message.type() === 'error') errors.push(message.text()); });
  await page.goto('/?viz=orbital&mute&autostart');
  await expect(page).toHaveTitle(/Cybern(?:oe|œ|ɶ)tica/i);
  expect(new URL(page.url()).searchParams.get('viz')).toBe('orbital');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Developer workbench',
  });
  await expect(panel).toBeVisible();
  await expect(
    panel.locator('[data-section=visual] input[type=range]').first(),
  ).toBeVisible();
  const slider = panel
    .locator('[data-section=visual] input[type=range]')
    .first();
  await slider.fill((await slider.getAttribute('min')) ?? '0');
  await slider.dispatchEvent('input');
  await panel
    .getByRole('button', { name: 'Record state', exact: true })
    .click();
  await expect(panel.locator('[data-section=capture] pre')).toContainText(
    'cybernoetica.session',
  );
  expect(
    JSON.parse(await panel.locator('[data-section=capture] pre').innerText())
      .visualizer.params.glowMultiplier,
  ).toBe(0.3);
  await panel
    .getByRole('textbox', { name: 'Annotation text' })
    .fill('Keep this quieter orbit as the new default.');
  await panel
    .getByRole('button', { name: 'Add annotation', exact: true })
    .click();
  await expect(panel.locator('.dev-annotation')).toContainText('quieter orbit');
  await panel.getByRole('button', { name: 'Locate visualizer source' }).click();
  await expect(
    panel.locator('[data-section=source] pre').first(),
  ).toContainText('orbital/v01-alpha.ts:');
  await panel
    .getByRole('combobox', { name: 'Workbench layout' })
    .selectOption('wide');
  await expect(panel).toHaveAttribute('data-layout', 'wide');
  await panel
    .getByRole('combobox', { name: 'Menu style' })
    .selectOption('constellation');
  await expect(page.locator('html')).toHaveAttribute(
    'data-menu-layout',
    'constellation',
  );
  await panel
    .getByRole('searchbox', { name: 'Search developer controls' })
    .fill('camera');
  await expect(panel.locator('[data-section=visual]')).toBeVisible();
  await panel
    .getByRole('searchbox', { name: 'Search developer controls' })
    .fill('');
  await panel.getByRole('button', { name: 'Fold all', exact: true }).click();
  await panel.getByRole('button', { name: 'Unfold all', exact: true }).click();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  await page.screenshot({
    path: `/tmp/cybernoetica-developer-${testInfo.project.name}.png`,
  });
  expect(errors).toEqual([]);
  expect(
    await page.locator('body').evaluate((e) => e.scrollWidth <= innerWidth),
  ).toBe(true);
});

test('active Soundscape, targeted edits, safe logs, and accessible control help', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?viz=orbital&audio=soundscape&mute');
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Developer workbench',
  });
  const sound = panel.locator('[data-section=sound]');
  const energy = sound.getByRole('slider', { name: 'Energy', exact: true });
  await energy.fill('0.25');
  await energy.dispatchEvent('input');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__cybernoetica?.journey?.source.getSoundscapeParams().energy,
      ),
    )
    .toBe(0.25);
  await panel
    .getByRole('button', { name: 'Pick annotation target', exact: true })
    .click();
  const glow = panel
    .locator('[data-section=visual]')
    .getByRole('slider', { name: 'Glow', exact: true });
  const beforePicking = await glow.inputValue();
  await glow.click();
  await expect(glow).toHaveValue(beforePicking);
  await panel
    .getByRole('textbox', { name: 'Annotation text' })
    .fill('Adjust this glow.');
  await panel
    .getByRole('button', { name: 'Add annotation', exact: true })
    .click();
  await expect(panel.locator('.dev-annotation')).toContainText(
    'param:glowMultiplier',
  );
  await panel
    .getByRole('button', { name: 'Record state', exact: true })
    .click();
  const recorded = JSON.parse(
    await panel.locator('[data-section=capture] pre').innerText(),
  );
  expect(recorded.soundscape.params.energy).toBe(0.25);
  expect(recorded.annotations[0].selector).toContain(
    'data-debug-scope="visual"',
  );
  expect(await page.locator(recorded.annotations[0].selector).count()).toBe(1);
  await page.evaluate(() =>
    console.warn('<img src=x onerror="window.bad=true"> inspect this'),
  );
  await expect(panel.locator('.dev-log')).toContainText('inspect this');
  expect(await panel.locator('.dev-log img').count()).toBe(0);
  await panel
    .getByRole('searchbox', { name: 'Search developer controls' })
    .fill('brighter');
  expect(await panel.locator('.control-help[open]').count()).toBe(0);
  await panel
    .getByRole('searchbox', { name: 'Search developer controls' })
    .fill('');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Sound', exact: true }).click();
  await expect(
    page.getByRole('slider', { name: 'Energy', exact: true }),
  ).toHaveValue('0.25');
  const help = page.getByLabel('About Analysis gain', { exact: true });
  await help.click();
  await expect(
    page.getByRole('img', { name: /Analysis gain: qualitative/ }),
  ).toBeVisible();
  await help.press('Escape');
  expect(errors).toEqual([]);
});

test('Journey editor in the workbench updates the active route', async ({
  page,
}) => {
  await page.goto('/?viz=lissajous&audio=soundscape&mute');
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Lissajous', {
    timeout: 20000,
  });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Developer workbench',
  });
  const journey = panel.locator('[data-section=journey]');
  await journey
    .getByLabel('Presentation', { exact: true })
    .selectOption('unified');
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.journey?.definition.style),
    )
    .toBe('unified');
  await panel
    .getByRole('button', { name: 'Record state', exact: true })
    .click();
  expect(
    JSON.parse(await panel.locator('[data-section=capture] pre').innerText())
      .journey.style,
  ).toBe('unified');
});

test('canvas annotation returns from picking mode with a normalized point', async ({
  page,
}) => {
  await page.goto('/?viz=lissajous&mute');
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Developer workbench',
  });
  await panel
    .getByRole('button', { name: 'Annotate canvas', exact: true })
    .click();
  await expect(panel).toBeHidden();
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 100, y: 100 } });
  await expect(panel).toBeVisible();
  await panel
    .getByRole('textbox', { name: 'Annotation text' })
    .fill('Focus on this region.');
  await panel
    .getByRole('button', { name: 'Add annotation', exact: true })
    .click();
  await panel
    .getByRole('button', { name: 'Record state', exact: true })
    .click();
  const data = JSON.parse(
    await panel.locator('[data-section=capture] pre').innerText(),
  );
  expect(data.annotations[0].target).toBe('visualizer:lissajous');
  expect(data.annotations[0].point.x).toBeGreaterThan(0);
  expect(data.annotations[0].point.x).toBeLessThan(1);
});
