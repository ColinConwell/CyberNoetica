#!/usr/bin/env npx tsx
/**
 * Static analysis audit of CSS transitions and animations in the UI layer.
 *
 * Scans all TypeScript files under apps/web/src/ui/ for:
 * - transition: declarations and their timing/property values
 * - animation: and @keyframes declarations
 * - Elements that change position (bottom/top) without transition
 *
 * Reports a catalog of all animation values and flags inconsistencies.
 *
 * Usage: npx tsx scripts/audit-ui-animations.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const UI_DIR = join(__dirname, '..', 'apps', 'web', 'src', 'ui');
const ROOT = join(__dirname, '..');

interface TransitionEntry {
  file: string;
  line: number;
  value: string;
  properties: string[];
}

interface AnimationEntry {
  file: string;
  line: number;
  value: string;
}

interface PositionChange {
  file: string;
  line: number;
  property: string;
  hasTransition: boolean;
}

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkDir(full));
    } else if (full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function parseTransitionProperties(value: string): string[] {
  return value.split(',').map(part => {
    const prop = part.trim().split(/\s+/)[0];
    return prop || 'unknown';
  });
}

function audit() {
  const files = walkDir(UI_DIR);
  const transitions: TransitionEntry[] = [];
  const animations: AnimationEntry[] = [];
  const positionChanges: PositionChange[] = [];
  const keyframes: { file: string; line: number; name: string }[] = [];

  for (const filepath of files) {
    const content = readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');
    const rel = relative(ROOT, filepath);

    const fileTransitionProps = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Capture transition values
      const transMatch = line.match(/transition:\s*['"`]([^'"`]+)['"`]/);
      if (transMatch) {
        const val = transMatch[1];
        const props = parseTransitionProperties(val);
        transitions.push({ file: rel, line: lineNum, value: val, properties: props });
        props.forEach(p => fileTransitionProps.add(p));
      }

      // Capture animation values
      const animMatch = line.match(/animation:\s*['"`]([^'"`]+)['"`]/);
      if (animMatch) {
        animations.push({ file: rel, line: lineNum, value: animMatch[1] });
      }

      // Capture @keyframes
      const kfMatch = line.match(/@keyframes\s+(\w+)/);
      if (kfMatch) {
        keyframes.push({ file: rel, line: lineNum, name: kfMatch[1] });
      }

      // Detect dynamic bottom/top changes (style.bottom = or style.top =)
      if (line.match(/\.style\.bottom\s*=/) || line.match(/\.style\.top\s*=/)) {
        const prop = line.includes('.bottom') ? 'bottom' : 'top';
        positionChanges.push({
          file: rel,
          line: lineNum,
          property: prop,
          hasTransition: fileTransitionProps.has('bottom') || fileTransitionProps.has('top') || fileTransitionProps.has('all'),
        });
      }
    }
  }

  // Report
  console.log('=== UI Animation Audit ===\n');

  console.log(`--- Transitions (${transitions.length} found) ---`);
  const timingGroups = new Map<string, TransitionEntry[]>();
  for (const t of transitions) {
    for (const segment of t.value.split(',')) {
      const timing = segment.trim().replace(/^\w+\s+/, '');
      const group = timingGroups.get(timing) ?? [];
      group.push(t);
      timingGroups.set(timing, group);
    }
  }
  for (const [timing, entries] of [...timingGroups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  "${timing}" (${entries.length} uses)`);
    for (const e of entries) {
      console.log(`    ${e.file}:${e.line}`);
    }
  }

  console.log(`\n--- Keyframes (${keyframes.length} found) ---`);
  for (const kf of keyframes) {
    console.log(`  @keyframes ${kf.name} -- ${kf.file}:${kf.line}`);
  }

  console.log(`\n--- Animations (${animations.length} found) ---`);
  for (const a of animations) {
    console.log(`  ${a.file}:${a.line} -- ${a.value}`);
  }

  console.log(`\n--- Position Changes (${positionChanges.length} found) ---`);
  const noTransition = positionChanges.filter(p => !p.hasTransition);
  if (noTransition.length > 0) {
    console.log(`  WARNING: ${noTransition.length} position change(s) without matching transition:`);
    for (const p of noTransition) {
      console.log(`    ${p.file}:${p.line} -- .style.${p.property} changed without transition`);
    }
  } else {
    console.log('  All position changes have matching transitions.');
  }

  const withTransition = positionChanges.filter(p => p.hasTransition);
  if (withTransition.length > 0) {
    console.log(`  OK: ${withTransition.length} position change(s) with transitions.`);
  }

  console.log('\n=== Audit Complete ===');
}

audit();
