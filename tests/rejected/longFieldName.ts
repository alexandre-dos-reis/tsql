/**
 * Rejected: a flattened column name longer than 63 bytes.
 *
 * PostgreSQL silently truncates identifiers past 63 bytes, so two long names that
 * share a prefix would collapse into the same column without any error:
 *
 *     -- some_very_long_outer_field_name_that_goes_on_and_on_and_an_inner_field_name_...
 *     -- would be cut to 63 bytes
 *
 * Shorten the field names.
 */
type LongNames = {
  someVeryLongOuterFieldNameThatGoesOnAndOn: {
    andAnInnerFieldNameThatIsAlsoExtremelyLong: string;
  };
};

export function readIt(long: LongNames): string {
  return long.someVeryLongOuterFieldNameThatGoesOnAndOn.andAnInnerFieldNameThatIsAlsoExtremelyLong;
}
