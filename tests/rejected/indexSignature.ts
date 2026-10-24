interface Bag {
  [key: string]: string;
}

export function isEmptyBag(bag: Bag): boolean {
  return bag !== null;
}
