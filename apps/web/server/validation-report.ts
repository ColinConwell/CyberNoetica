import express from 'express';
import type { Router } from 'express';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Local QA preview only. Never mounted by the production server. */
export function createValidationReportRouter(): Router {
  const router = express.Router();
  router.post(
    '/',
    express.json({ limit: '32mb' }),
    async (request, response) => {
      const report = request.body;
      if (!Array.isArray(report?.results) || !Array.isArray(report?.previews)) {
        response.sendStatus(400);
        return;
      }
      const directory = join(
        tmpdir(),
        'cybernoetica-validation',
        new Date().toISOString().replaceAll(':', '-'),
      );
      await mkdir(directory, { recursive: true });
      for (const [index, preview] of report.previews.entries()) {
        if (
          typeof preview.type !== 'string' ||
          !/^[a-z0-9-]+$/.test(preview.type) ||
          typeof preview.image !== 'string' ||
          !preview.image.startsWith('data:image/png;base64,')
        )
          continue;
        await writeFile(
          join(directory, `${index}-${preview.type}.png`),
          Buffer.from(preview.image.slice(22), 'base64'),
        );
      }
      const { previews, ...measurements } = report;
      await writeFile(
        join(directory, 'results.json'),
        JSON.stringify(measurements, null, 2),
      );
      response.json({ directory });
    },
  );
  return router;
}
