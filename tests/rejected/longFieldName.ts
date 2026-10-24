type LongNames = {
  someVeryLongOuterFieldNameThatGoesOnAndOn: {
    andAnInnerFieldNameThatIsAlsoExtremelyLong: string;
  };
};

export function readIt(long: LongNames): string {
  return long.someVeryLongOuterFieldNameThatGoesOnAndOn.andAnInnerFieldNameThatIsAlsoExtremelyLong;
}
