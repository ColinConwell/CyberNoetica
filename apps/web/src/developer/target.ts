/** Prefer the app's explicit control contract. A structural path is a labeled fallback. */
export function describeTarget(element: HTMLElement): {
  selector: string;
  target: string;
  strategy: 'control-id' | 'accessible-name' | 'structure' | 'canvas';
} {
  const owner = element.closest<HTMLElement>('[data-control-id]');
  const scope = element.closest<HTMLElement>('[data-debug-scope]');
  const prefix = scope
    ? `[data-debug-scope=${JSON.stringify(scope.dataset.debugScope)}] `
    : '';
  const id = owner?.dataset.controlId;
  if (id && (!scope || scope.contains(owner))) {
    const selector = `${prefix}[data-control-id=${JSON.stringify(id)}]`;
    if (document.querySelectorAll(selector).length === 1)
      return { selector, target: id, strategy: 'control-id' };
  }
  if (element.tagName === 'CANVAS')
    return { selector: 'canvas', target: 'visualizer', strategy: 'canvas' };
  const name = element.getAttribute('aria-label');
  if (name) {
    const selector = `${prefix}${element.tagName.toLowerCase()}[aria-label=${JSON.stringify(name)}]`;
    if (document.querySelectorAll(selector).length === 1)
      return { selector, target: name, strategy: 'accessible-name' };
  }
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== scope && current !== document.body) {
    const node: HTMLElement = current;
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (e) => e.tagName === node.tagName,
    );
    parts.unshift(
      `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`,
    );
    current = node.parentElement;
  }
  return {
    selector: `${prefix}${parts.join(' > ')}`,
    target:
      name ?? element.textContent?.trim().slice(0, 100) ?? element.tagName,
    strategy: 'structure',
  };
}
