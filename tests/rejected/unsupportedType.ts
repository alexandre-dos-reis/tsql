export function isPast(when: Date): boolean {
  return when.getTime() < 0;
}
