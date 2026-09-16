import { test, expect, type Page } from '@playwright/test';
async function boot(page: Page, viz = 'lissajous') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto(`/?viz=${viz}&audio=soundscape&mute`);
  await expect(page).toHaveTitle(/Cybern(?:oe|œ|ɶ)tica/i);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.vizManager?.getActiveType()),
    )
    .toBe(viz);
  return errors;
}
const view = (page: Page) =>
  page.evaluate(() =>
    window.__cybernoetica!.vizManager!.getActive()!.getViewState(),
  );
async function drag(
  page: Page,
  modifier?: string,
  button: 'left' | 'middle' = 'middle',
) {
  const box = (await page.locator('#app canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.down({ button });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up({ button });
  if (modifier) await page.keyboard.up(modifier);
}
test('studio group stays visible by default, persists hover/fade and reveals together', async ({
  page,
}, info) => {
  const errors = await boot(page);
  const group = page.getByRole('group', {
    name: 'Studio Controls',
    exact: true,
  });
  await expect(
    group.getByRole('button', { name: '✦ AI Studio', exact: true }),
  ).toBeVisible();
  await expect(
    group.getByRole('button', { name: '◈ Developer', exact: true }),
  ).toBeVisible();
  await page.mouse.move(5, 300);
  await page.waitForTimeout(5500);
  await expect(page.locator('#control-bar')).toHaveCSS('opacity', '1');
  await expect(group).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: `/tmp/cyber-studio-group-${info.project.name}.png`,
  });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page
    .getByLabel('Control Visibility', { exact: true })
    .selectOption('auto');
  await page.getByLabel('Menu fade delay', { exact: true }).fill('2');
  await page.keyboard.press('Escape');
  await page.locator('#app canvas').click({ position: { x: 10, y: 250 } });
  await page.mouse.move(5, 300);
  await expect(group).toHaveCSS('opacity', '0', { timeout: 4500 });
  await expect(page.locator('#control-bar')).toHaveCSS('opacity', '0');
  const bounds = (await group.boundingBox())!;
  await page.mouse.move(bounds.x + 5, bounds.y + 5);
  await expect(group).toHaveCSS('opacity', '1');
  await expect(page.locator('#control-bar')).toHaveCSS('opacity', '1');
  await group.getByRole('button', { name: '✦ AI Studio' }).click();
  await expect(
    page.getByRole('heading', { name: 'AI Studio', exact: true }),
  ).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(
      () => window.__cybernoetica!.store.getState().ui.controlsVisibility,
    ),
  ).toBe('auto');
  expect(errors).toEqual([]);
});
test('2D pan, proportional wheel/pinch zoom and 3D orbit/pan/dolly', async ({
  page,
}) => {
  const errors = await boot(page);
  let before = await view(page);
  await drag(page);
  let after = await view(page);
  expect(after.centerX).not.toBe(before.centerX);
  const canvas = page.locator('#app canvas');
  before = after;
  await canvas.dispatchEvent('wheel', {
    deltaY: -1,
    deltaMode: 0,
    ctrlKey: true,
  });
  after = await view(page);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(after.zoom / before.zoom).toBeLessThan(1.01);
  await canvas.dispatchEvent('wheel', { deltaY: 0, deltaMode: 0 });
  expect((await view(page)).zoom).toBe(after.zoom);
  await boot(page, 'orbital');
  before = await view(page);
  await drag(page);
  after = await view(page);
  expect(Math.abs(after.orbitAngle - before.orbitAngle)).toBeGreaterThan(0.2);
  await drag(page, 'Shift');
  const panned = await view(page);
  expect(Math.abs(panned.targetX) + Math.abs(panned.targetY)).toBeGreaterThan(
    0.1,
  );
  await drag(page, 'Control');
  expect((await view(page)).distance).toBeGreaterThan(panned.distance);
  await drag(page, 'Alt', 'left');
  expect(
    Math.abs((await view(page)).orbitAngle - panned.orbitAngle),
  ).toBeGreaterThan(0.2);
  expect(errors).toEqual([]);
});
test('touch pinch/pan cancels cleanly and 2D rotation respects supported fields', async ({
  page,
}) => {
  const errors = await boot(page);
  const client = await page.context().newCDPSession(page);
  const before = await view(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 110, y: 220, id: 1 },
      { x: 230, y: 220, id: 2 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 100, y: 250, id: 1 },
      { x: 270, y: 250, id: 2 },
    ],
  });
  await expect
    .poll(async () => (await view(page)).zoom)
    .toBeGreaterThan(before.zoom);
  expect((await view(page)).centerY).not.toBe(before.centerY);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  const stopped = await view(page);
  await page.mouse.move(300, 300);
  expect((await view(page)).centerX).toBe(stopped.centerX);
  await drag(page);
  expect((await view(page)).centerX).not.toBe(stopped.centerX);
  await boot(page, 'kaleidoscope');
  await page
    .locator('#app canvas')
    .dispatchEvent('wheel', { deltaY: 80, altKey: true });
  const rotated = await view(page);
  await page.waitForTimeout(200);
  expect((await view(page)).rotation).toBe(rotated.rotation); // manual override pauses this animated axis
  await drag(page, 'Alt', 'left');
  expect((await view(page)).rotation).not.toBe(rotated.rotation);
  expect(errors).toEqual([]);
});
test('canvas keyboard reset restores camera target and sculpt clicks remain separate from navigation', async ({
  page,
}) => {
  const errors = await boot(page, 'orbital');
  await drag(page, 'Shift');
  expect(Math.abs((await view(page)).targetX)).toBeGreaterThan(0.1);
  await page.keyboard.press('r');
  await expect.poll(async () => (await view(page))?.targetX).toBe(0);
  await boot(page, 'orbital-gamma');
  await page.evaluate(() =>
    window
      .__cybernoetica!.vizManager!.getActive()!
      .setUserParam('sculptMode', 1),
  );
  const objects = () =>
    page.evaluate(() => window.__cybernoetica!.scene.scene.children.length);
  const before = await objects();
  await page.locator('#app canvas').click({ position: { x: 150, y: 250 } });
  await expect.poll(objects).toBeGreaterThan(before);
  const sculpted = await objects();
  await drag(page, 'Alt', 'left');
  expect(await objects()).toBe(sculpted);
  await drag(page, undefined, 'middle');
  expect(await objects()).toBe(sculpted);
  expect(errors).toEqual([]);
});
