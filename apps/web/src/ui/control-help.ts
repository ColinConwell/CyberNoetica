/** Focus-, pointer- and touch-accessible help, with honest qualitative schematics. */
let nextHelp = 0;
export function controlHelp(
  label: string,
  description: string,
  key: string,
): HTMLElement {
  const details = document.createElement('details');
  details.className = 'control-help';
  const summary = document.createElement('summary');
  summary.textContent = '?';
  summary.setAttribute('aria-label', `About ${label}`);
  const content = document.createElement('div');
  content.id = `control-help-${++nextHelp}`;
  summary.setAttribute('aria-controls', content.id);
  const text = document.createElement('p');
  text.textContent = description;
  content.append(text);
  const kind = /gain|bass|response|audio/i.test(key)
    ? 'response'
    : /speed|rate|frequency|tempo/i.test(key)
      ? 'frequency'
      : /zoom|distance|scale/i.test(key)
        ? 'scale'
        : null;
  if (kind) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 180 44');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `${label}: qualitative low to high illustration`,
    );
    const paths =
      kind === 'response'
        ? ['M4 28 L38 22 L72 28', 'M104 28 L138 4 L172 28']
        : kind === 'frequency'
          ? [
              'M4 22 Q21 0 38 22 T72 22',
              'M104 22 Q110 0 116 22 T128 22 T140 22 T152 22 T164 22 T176 22',
            ]
          : ['M18 12 H42 V36 H18 Z', 'M120 4 H160 V44 H120 Z'];
    for (const d of paths) {
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#a8baff');
      path.setAttribute('stroke-width', '2');
      svg.append(path);
    }
    const caption = document.createElement('small');
    caption.textContent = 'Low → high · schematic, not a rendered preview';
    content.append(svg, caption);
  }
  details.append(summary, content);
  details.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      details.open = false;
      summary.focus();
    }
  });
  return details;
}
