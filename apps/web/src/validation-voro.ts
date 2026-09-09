import { loadVoroBackend } from '@cybernoetica/renderer';

/** Independent volume and identity checks against the shipped native WASM. */
export async function validateVoro(): Promise<
  Array<{ check: string; error?: string }>
> {
  const results: Array<{ check: string; error?: string }> = [];
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const xyz = new Float32Array([
    -1, -1, -1, 1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, -1, 1, -1, 1, 1,
    1, 1, 1,
  ]);
  for (const mode of ['box', 'periodic', 'radical'] as const) {
    const backend = await loadVoroBackend({ mode, halfExtent: 2 });
    const name =
      mode === 'radical'
        ? 'Weighted hidden-cell identity and reappearance'
        : `${mode}: partition volume and stable identity`;
    try {
      check(!!backend, 'WASM failed to load');
      const mesh = backend!.compute(xyz)!;
      check(mesh.cellCount === 8, 'Expected eight visible cells');
      check(
        Math.abs(mesh.volumes.reduce((a, b) => a + b, 0) - 64) < 1e-4,
        'Partition does not fill the box',
      );
      check(
        mesh.seedIds.every((id, index) => id === index),
        'Unexpected seed identity',
      );
      check(mesh.vertices.every(Number.isFinite), 'Nonfinite native vertices');
      if (mode === 'periodic') {
        // Translate through the fundamental domain boundary; wrap back to [-2,2).
        const translated = xyz.map(
          (value, i) =>
            ((((value + [1.7, 0.3, -0.2][i % 3] + 2) % 4) + 4) % 4) - 2,
        );
        const moved = backend!.compute(translated)!;
        check(
          Math.abs(moved.volumes.reduce((a, b) => a + b, 0) - 64) < 1e-4,
          'Periodic volume changed',
        );
        for (let i = 0; i < moved.cellCount; i++)
          check(
            Math.abs(moved.volumes[i] - 8) < 1e-4,
            'Translation changed a periodic cell volume',
          );
      }
      if (mode === 'radical') {
        const close = new Float32Array([0, 0, 0, 0.1, 0, 0]);
        const hidden = backend!.compute(close, new Float32Array([0, 1]))!;
        check(
          hidden.cellCount === 1 && hidden.seedIds[0] === 1,
          'Hidden seed shifted the persistent ID',
        );
        const visible = backend!.compute(close, new Float32Array([0, 0]))!;
        check(
          visible.cellCount === 2 &&
            visible.seedIds.includes(0) &&
            visible.seedIds.includes(1),
          'Reappearing seed lost its identity',
        );
        check(
          Math.abs(visible.volumes.reduce((a, b) => a + b, 0) - 64) < 1e-4,
          'Weighted partition volume failed',
        );
      }
      results.push({ check: name });
    } catch (error) {
      results.push({ check: name, error: String(error) });
    } finally {
      backend?.dispose();
    }
  }
  return results;
}
