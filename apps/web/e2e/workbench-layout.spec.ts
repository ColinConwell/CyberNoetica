import { test, expect, type Page } from '@playwright/test';
async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?viz=lissajous&audio=soundscape&mute');
  await expect(page).toHaveTitle(/Cybern(?:oe|œ|ɶ)tica/i);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Developer workbench',
    exact: true,
  });
  await expect(
    panel.getByRole('heading', { name: 'Developer Workbench', exact: true }),
  ).toBeVisible();
  return { panel, errors };
}
test('launcher positions match main buttons and persist', async ({ page }) => {
  const { panel, errors } = await open(page);
  const launch = page.locator('.dev-launch'),
    bar = page.locator('#control-bar');
  await expect(launch).toHaveAttribute('data-position', 'above');
  await expect
    .poll(async () => {
      const a = await launch.boundingBox(),
        b = await bar.boundingBox();
      return b!.y - a!.y - a!.height;
    })
    .toBeGreaterThan(3);
  const a = await launch.boundingBox(),
    b = await bar.boundingBox();
  expect(Math.abs(a!.x + a!.width / 2 - b!.x - b!.width / 2)).toBeLessThan(2);
  const fonts = await page.evaluate(() => {
    const a = getComputedStyle(document.querySelector('.dev-launch')!),
      b = getComputedStyle(document.querySelector('#control-bar button')!);
    return [
      a.fontSize === b.fontSize,
      a.padding === b.padding,
      a.borderRadius === b.borderRadius,
    ];
  });
  expect(fonts).toEqual([true, true, true]);
  for (const value of [
    'in-bar',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
    'above',
  ]) {
    await panel
      .getByLabel('Developer button position', { exact: true })
      .selectOption(value);
    await expect(launch).toHaveAttribute('data-position', value);
    if (value === 'in-bar')
      await expect(bar.locator('.dev-launch')).toHaveCount(1);
    else
      await expect(page.locator('#app-surface > .dev-launch')).toHaveCount(1);
  }
  await panel
    .getByLabel('Developer button position', { exact: true })
    .selectOption('in-bar');
  await page.reload();
  await expect(page.locator('#control-bar > .dev-launch')).toBeVisible();
  expect(errors).toEqual([]);
});
test('docks displace the complete app and close restores viewport', async ({
  page,
}, info) => {
  const { panel, errors } = await open(page);
  for (const mode of ['right', 'left', 'top', 'bottom']) {
    await panel
      .getByLabel('Workbench layout', { exact: true })
      .selectOption(mode);
    await expect(panel).toHaveAttribute('data-layout', mode);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document.querySelector('#app')!.getBoundingClientRect(),
            canvas = document
              .querySelector('#app canvas')!
              .getBoundingClientRect();
          return (
            Math.abs(r.width - canvas.width) +
            Math.abs(r.height - canvas.height)
          );
        }),
      )
      .toBeLessThan(2);
    const p = await panel.boundingBox(),
      s = await page.locator('#app-surface').boundingBox();
    if (mode === 'right') expect(s!.x + s!.width).toBeCloseTo(p!.x, 0);
    if (mode === 'left') expect(s!.x).toBeCloseTo(p!.x + p!.width, 0);
    if (mode === 'top') expect(s!.y).toBeCloseTo(p!.y + p!.height, 0);
    if (mode === 'bottom') expect(s!.y + s!.height).toBeCloseTo(p!.y, 0);
    const c = await page.locator('#control-bar').boundingBox();
    expect(c!.x).toBeGreaterThanOrEqual(s!.x - 1);
    expect(c!.x + c!.width).toBeLessThanOrEqual(s!.x + s!.width + 1);
    await expect
      .poll(async () => {
        const a = await page.locator('.dev-launch').boundingBox(),
          b = await page.locator('#control-bar').boundingBox();
        return b!.y - a!.y - a!.height;
      })
      .toBeGreaterThan(3);
    if (mode === 'left') {
      await page.getByRole('button', { name: 'Sound', exact: true }).click();
      const standard = page.locator('.standard-panel');
      await expect(standard).toBeVisible();
      const bounds = await standard.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(s!.x - 1);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
        s!.x + s!.width + 1,
      );
      await standard
        .getByRole('slider', { name: 'Energy', exact: true })
        .fill('0.3');
      await standard
        .getByRole('slider', { name: 'Energy', exact: true })
        .dispatchEvent('input');
      expect(
        await page.evaluate(
          () =>
            window.__cybernoetica?.journey?.source.getSoundscapeParams().energy,
        ),
      ).toBe(0.3);
      await page.getByRole('button', { name: 'Sound', exact: true }).click();
    }
    if (mode === 'right' || mode === 'bottom')
      await page.screenshot({
        path: `/tmp/cyber-workbench-${mode}-${info.project.name}.png`,
      });
  }
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('#app-surface')
        .evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBe(page.viewportSize()!.height);
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  await panel
    .getByLabel('Workbench layout', { exact: true })
    .selectOption('dock');
  expect(
    await page
      .locator('#app-surface')
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBe(page.viewportSize()!.width);
  expect(errors).toEqual([]);
});
test('reorder and resize grids with keyboard and pointer, then restore saved layout', async ({
  page,
}, info) => {
  const { panel, errors } = await open(page);
  await panel
    .getByLabel('Workbench layout', { exact: true })
    .selectOption('bottom');
  await panel.getByRole('button', { name: 'Fold all', exact: true }).click();
  const capture = panel.locator('[data-section=capture]'),
    visual = panel.locator('[data-section=visual]');
  const handle = capture.getByRole('button', {
    name: 'Drag Record & Annotate to reorder',
  });
  await handle.focus();
  await handle.press('ArrowDown');
  await expect(panel.locator('.dev-section').first()).toHaveAttribute(
    'data-section',
    'visual',
  );
  if (info.project.name === 'desktop') {
    const from = await visual
        .getByRole('button', { name: 'Drag Visualizer Controls to reorder' })
        .boundingBox(),
      to = await capture.boundingBox();
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width - 20, to!.y + to!.height / 2, {
      steps: 10,
    });
    await page.mouse.up();
    await expect(panel.locator('.dev-section').first()).toHaveAttribute(
      'data-section',
      'capture',
    );
  }
  if (info.project.name === 'desktop') {
    const beforeOrder = await panel
      .locator('.dev-section')
      .evaluateAll((es) => es.map((e) => (e as HTMLElement).dataset.section));
    const grip = await capture
      .getByRole('button', { name: 'Drag Record & Annotate to reorder' })
      .boundingBox();
    const destination = await visual.boundingBox();
    await page.mouse.move(
      grip!.x + grip!.width / 2,
      grip!.y + grip!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      destination!.x + destination!.width - 15,
      destination!.y + destination!.height / 2,
      { steps: 8 },
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(panel).toBeVisible();
    expect(
      await panel
        .locator('.dev-section')
        .evaluateAll((es) => es.map((e) => (e as HTMLElement).dataset.section)),
    ).toEqual(beforeOrder);
  }
  await capture.locator('summary').first().click();
  const resize = capture.getByRole('button', {
    name: 'Resize Record & Annotate',
    exact: true,
  });
  await resize.scrollIntoViewIfNeeded();
  const before = await capture.boundingBox();
  await resize.focus();
  await resize.press('ArrowDown');
  await expect
    .poll(async () => (await capture.boundingBox())!.height)
    .toBeGreaterThan(before!.height + 25);
  if (info.project.name === 'desktop') {
    await resize.scrollIntoViewIfNeeded();
    const grip = await resize.boundingBox(),
      old = await capture.boundingBox();
    await page.mouse.move(
      grip!.x + grip!.width / 2,
      grip!.y + grip!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(grip!.x + 100, grip!.y + 45, { steps: 8 });
    await page.mouse.up();
    expect((await capture.boundingBox())!.width).toBeGreaterThan(old!.width);
  }
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cybernoetica:workbench:v1')!),
  );
  expect(saved.sizes.capture.height).toBeGreaterThan(before!.height);
  await page.reload();
  await page.getByRole('button', { name: '◈ Developer', exact: true }).click();
  await expect(panel).toHaveAttribute('data-layout', 'bottom');
  await expect(panel.locator('.dev-section').first()).toHaveAttribute(
    'data-section',
    saved.order[0],
  );
  expect(errors).toEqual([]);
});
test('annotation and source actions have coherent groups and visualizer context', async ({
  page,
}, info) => {
  if (info.project.name === 'desktop')
    await page.setViewportSize({ width: 867, height: 998 });
  const { panel, errors } = await open(page);
  await expect(
    panel.locator('[data-section=visual] .dev-state-chip'),
  ).toHaveText('Lissajous');
  await expect(panel.locator('[data-section=visual]')).not.toContainText(
    'appearance/audio controls',
  );
  for (const label of [
    'Configuration actions',
    'Choose annotation target',
    'Annotation actions',
    'Export configuration and handoff',
    'Source file actions',
    'Section Folding',
  ])
    await expect(
      panel.getByRole('group', { name: label, exact: true }),
    ).toHaveCount(1);
  expect(
    await panel.locator('.dev-section > summary').allTextContents(),
  ).not.toEqual(expect.arrayContaining([expect.stringMatching(/^\d\d\s*\//)]));
  await panel
    .getByRole('button', { name: 'Locate visualizer source', exact: true })
    .click();
  await expect(
    panel.locator('[data-section=source] pre').first(),
  ).toContainText('lissajous/v01-alpha.ts');
  await panel.locator('.dev-sections').evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({
    path: `/tmp/cyber-workbench-refined-${info.project.name}.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
