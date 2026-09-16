import { test, expect } from '@playwright/test';

test('Journey transport, traces and contributor sensitivity persist and render', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?viz=lissajous&audio=soundscape&mute');
  await expect(page).toHaveTitle(/Cybern(?:oe|œ|ɶ)tica/i);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText('Lissajous', {
    timeout: 20000,
  });
  await page.getByText('Transition motion', { exact: true }).click();
  await page
    .getByLabel('Point matching', { exact: true })
    .selectOption('polar');
  await page.getByLabel('Flight path', { exact: true }).selectOption('vortex');
  await page
    .getByLabel('Transition marks', { exact: true })
    .selectOption('traces');
  const bend = page.getByLabel('Path bend', { exact: true });
  await bend.fill('0.75');
  await bend.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__cybernoetica?.journey?.definition.transitionLook,
      ),
    )
    .toEqual({
      path: 'vortex',
      rendering: 'traces',
      curvature: 0.75,
      traceLength: 0.12,
    });
  await page
    .getByTestId('journey-stop')
    .first()
    .getByText('Compose · 1 contributor', { exact: true })
    .click();
  await page.getByText('1 · Lissajous', { exact: true }).first().click();
  await page
    .getByTestId('journey-stop')
    .first()
    .getByText('Audio response', { exact: true })
    .click();
  const sensitivity = page
    .getByTestId('journey-stop')
    .first()
    .getByLabel('Audio sensitivity', { exact: true });
  await expect(sensitivity).toHaveValue('2.5');
  await sensitivity.fill('6');
  await sensitivity.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__cybernoetica?.journey?.definition.stops[0].layers[0].params
            .audioSensitivity,
      ),
    )
    .toBe(6);
  // Check the worker selection as well as the persisted selector.
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.journey?.state?.solver),
    )
    .toBe('polar');
  await page
    .getByLabel('Presentation', { exact: true })
    .selectOption('unified');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('journey-status')).toContainText(
    'transitioning',
  );
  await page
    .getByRole('button', { name: 'Pause Journey', exact: true })
    .click();
  await page.evaluate(() => {
    const active = window.__cybernoetica?.journey?.active;
    if (active) active.state.progress = 0.5;
  });
  const fingerprints = new Set<number>();
  const captures: unknown[] = [];
  // Exercise every shader branch while holding a real transition and its endpoint geometry fixed.
  for (const path of ['direct', 'arc', 'vortex'])
    for (const marks of ['particles', 'streaks', 'traces']) {
      await page.getByLabel('Flight path', { exact: true }).selectOption(path);
      await page
        .getByLabel('Transition marks', { exact: true })
        .selectOption(marks);
      await expect(
        page.getByLabel('Transition marks', { exact: true }),
      ).toHaveValue(marks);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const rendered = await page.evaluate(() => {
        const app = window.__cybernoetica!,
          renderer = app.scene.getRenderer()!;
        app.journey!.active!.tick(0);
        app.journey!.active!.renderFrame(renderer);
        const gl = renderer.getContext(),
          pixels = new Uint8Array(
            gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
          );
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let hash = 2166136261,
          energy = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          for (let c = 0; c < 3; c++)
            hash = Math.imul(hash ^ pixels[i + c], 16777619);
          energy += pixels[i] + pixels[i + 1] + pixels[i + 2];
        }
        return {
          hash,
          energy,
          error: gl.getError(),
          progress: app.journey!.state!.progress,
          look: app.journey!.definition.transitionLook,
        };
      });
      expect(rendered.error).toBe(0);
      expect(rendered.energy).toBeGreaterThan(0);
      fingerprints.add(rendered.hash);
      captures.push({ path, marks, ...rendered });
    }
  expect(fingerprints.size, JSON.stringify(captures)).toBe(9);
  await page.screenshot({
    path: `/tmp/cyber-journey-options-${info.project.name}.png`,
  });
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect(
    page.getByLabel('Point matching', { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: `/tmp/cyber-journey-traces-${info.project.name}.png`,
  });
  await page.reload();
  await page.getByRole('button', { name: 'Visual', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__cybernoetica?.journey?.definition.transport),
    )
    .toBe('polar');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__cybernoetica?.journey?.definition.transitionLook.rendering,
      ),
    )
    .toBe('traces');
});
