import { listVisualizers } from '@cybernoetica/renderer';
import type { JourneyQAResult } from './validation-journey.js';

/** Presentation only: matrix checks and their machine-readable results stay in the runner. */
export function createJourneyValidationView() {
  const element = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const runButton = element<HTMLButtonElement>('run');
  const exportButton = element<HTMLButtonElement>('export');
  const progress = element<HTMLProgressElement>('progress');
  const rows = element<HTMLTableSectionElement>('result-rows');
  const labels = new Map(
    listVisualizers().map((entry) => [entry.type, entry.label]),
  );
  const label = (type: string) => labels.get(type) ?? type;
  const titleCase = (value: string) =>
    value.charAt(0).toUpperCase() + value.slice(1);
  let results: JourneyQAResult[] = [];
  let issueCount = 0;
  let started = 0;
  let complete = false;

  function stage(title: string, description: string, symbol: string) {
    element('stage-message').hidden = false;
    element('stage-title').textContent = title;
    element('stage-description').textContent = description;
    element('stage-message').querySelector('.stage-symbol')!.textContent =
      symbol;
  }

  exportButton.addEventListener('click', () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(results, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `journey-validation${complete ? '' : '-partial'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  runButton.disabled = false;
  runButton.textContent = 'Run matrix';
  element('status').textContent = 'Ready';

  return {
    showPreview() {
      element('stage-message').hidden = true;
    },
    start(pairs: number, styles: number, fixtures: number) {
      results = [];
      issueCount = 0;
      complete = false;
      started = performance.now();
      runButton.disabled = true;
      runButton.textContent = 'Running…';
      exportButton.disabled = true;
      rows.replaceChildren();
      progress.max = Math.max(1, pairs * styles * fixtures);
      progress.value = 0;
      element('progress-count').textContent =
        `0 / ${pairs * styles * fixtures}`;
      element('results-count').textContent = 'Running';
      element('results-empty').textContent = 'Waiting for the first check…';
      element('results-empty').hidden = false;
      element('results-table').hidden = true;
      element('stage-message').hidden = true;
      element('passed').textContent = '0';
      element('issues').textContent = '0';
      element('passed').removeAttribute('data-active');
      element('issues').removeAttribute('data-active');
      element('scope').textContent =
        `${pairs} directed pairs · ${styles} ${styles === 1 ? 'style' : 'styles'} · ${fixtures} ${fixtures === 1 ? 'signal' : 'signals'}`;
      element('status').textContent = 'Running matrix';
    },
    current(source: string, target: string, style: string, fixture: string) {
      element('preview-label').textContent =
        `${label(source)} → ${label(target)}`;
      element('case-context').textContent =
        `${titleCase(style)} · ${titleCase(fixture)}`;
    },
    record(result: JourneyQAResult) {
      results.push(result);
      const issues = [result.error];
      if (result.remainingGeometries || result.remainingTextures) {
        issues.push(
          `Retained resources: ${result.remainingGeometries} geometries, ${result.remainingTextures} textures.`,
        );
      }
      const error = issues.filter(Boolean).join(' ');
      if (error) issueCount++;
      const row = document.createElement('tr');
      const route = row.insertCell();
      route.textContent = `${label(result.source)} → ${label(result.target)}`;
      if (error) {
        const detail = document.createElement('span');
        detail.className = 'cell-error';
        detail.textContent = error;
        route.append(detail);
      }
      const context = row.insertCell();
      context.textContent = titleCase(result.style);
      const signal = document.createElement('span');
      signal.className = 'cell-detail';
      signal.textContent = titleCase(result.fixture);
      context.append(signal);
      row.insertCell().textContent = `${result.cpuP95.toFixed(1)} ms`;
      const outcome = row.insertCell();
      outcome.textContent = error ? 'Issue' : 'Pass';
      outcome.className = error ? 'result-issue' : 'result-pass';
      // Keep issues visible at the top without moving focus or replacing the table.
      if (error) rows.prepend(row);
      else rows.append(row);
      progress.value = results.length;
      element('progress-count').textContent =
        `${results.length} / ${progress.max}`;
      element('passed').textContent = String(results.length - issueCount);
      element('issues').textContent = String(issueCount);
      element('passed').toggleAttribute(
        'data-active',
        results.length > issueCount,
      );
      element('issues').toggleAttribute('data-active', issueCount > 0);
      element('results-count').textContent = `${results.length} checks`;
      element('results-empty').hidden = true;
      element('results-table').hidden = false;
      exportButton.disabled = false;
    },
    finish() {
      complete = true;
      const elapsed = Math.round((performance.now() - started) / 1000);
      const duration =
        elapsed < 60
          ? `${elapsed}s`
          : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
      element('status').textContent = `Complete · ${duration}`;
      element('preview-label').textContent = 'Validation complete';
      element('case-context').textContent = `${results.length} checks`;
      if (!results.length) {
        stage(
          'No checks to run',
          'Choose at least two distinct models in the matrix options.',
          '—',
        );
        element('results-count').textContent = '0 checks';
        element('results-empty').textContent = 'No checks were run.';
      } else {
        stage(
          issueCount
            ? `${issueCount} ${issueCount === 1 ? 'check needs' : 'checks need'} attention`
            : 'All checks passed',
          issueCount
            ? 'Open results to inspect the flagged transitions.'
            : 'Geometry, shaders, continuity, and cleanup verified.',
          issueCount ? '!' : '✓',
        );
      }
    },
    fail(error: unknown) {
      element('status').textContent = 'Run interrupted';
      element('preview-label').textContent = 'Validation interrupted';
      element('case-context').textContent = '';
      element('results-count').textContent = `${results.length} checks`;
      element('results-empty').textContent =
        'The run stopped before completing a check.';
      stage('Unable to finish', String(error), '!');
    },
    release() {
      runButton.disabled = false;
      runButton.textContent = 'Run again';
    },
  };
}
