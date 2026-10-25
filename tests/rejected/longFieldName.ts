/**
 * Rejected: a field whose column name is longer than 63 bytes.
 *
 * PostgreSQL silently truncates identifiers past 63 bytes, so two long names that
 * share a prefix would collapse into the same column without any error:
 *
 *     -- some_very_long_field_name_that_goes_on_and_on_and_on_and_then_some_more
 *     -- would be cut to 63 bytes
 *
 * Shorten the field name.
 *
 * Expected: longer than PostgreSQL's 63-byte identifier limit
 */
type LongNames = {
  someVeryLongFieldNameThatGoesOnAndOnAndOnAndThenSomeMore: string;
};

export function readIt(long: LongNames): string {
  return long.someVeryLongFieldNameThatGoesOnAndOnAndOnAndThenSomeMore;
}
