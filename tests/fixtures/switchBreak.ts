export function score(grade: string, bonus: boolean): number {
  switch (grade) {
    case "a":
      if (bonus) {
        break;
      }
      return 5;
    default:
      return 1;
  }
  return 0;
}
