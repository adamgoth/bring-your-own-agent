import { validateBudget, type SiteBudget } from './usage';
export function budgetInputs(parent: HTMLElement, value: SiteBudget = {}) {
  const inputs = new Map<string, HTMLInputElement>();
  for (const [key, label] of [
    ['perTaskTokens', 'Per-task tokens'],
    ['perDayTokens', 'Daily tokens'],
    ['perDayUsd', 'Daily dollars (requires known cost)'],
  ] as const) {
    const row = document.createElement('label');
    row.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = key === 'perDayUsd' ? '0.000001' : '1';
    input.step = key === 'perDayUsd' ? 'any' : '1';
    input.placeholder = key === 'perTaskTokens' ? 'Global default' : 'No limit';
    input.value = value[key] === undefined ? '' : String(value[key]);
    input.setAttribute('aria-label', label);
    inputs.set(key, input);
    row.append(input);
    parent.append(row);
  }
  return () =>
    validateBudget(
      Object.fromEntries(
        [...inputs]
          .filter(([, input]) => input.value !== '')
          .map(([key, input]) => [key, Number(input.value)])
      )
    );
}
