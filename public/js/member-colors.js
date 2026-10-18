// Identity is based on the stored member index, never the order of respondents.
export function memberColor(index) {
  if (!Number.isInteger(index) || index < 0) return 'var(--ink-3)';
  if (index < 8) return `var(--m${index})`;
  return `hsl(${(index * 137.508 + 210) % 360} 48% 43%)`;
}

export function availablePeople(mask, people = []) {
  return people.filter(person => (BigInt(mask) & BigInt(person.bit)) !== 0n);
}
