export function score(grade: string, bonus: boolean): number {
  switch (grade) {
    case "a":
      if (bonus) {
        return 5;
      }
    case "b":
      return 2;
    default:
      return 0;
  }
  return 0;
}
