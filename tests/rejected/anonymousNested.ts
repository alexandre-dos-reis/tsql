/**
 * Rejected: a field whose type is an anonymous object shape.
 *
 * A field of an object type is a column of that type's own composite, as
 * PostgreSQL nests them, and `CREATE TYPE` needs a name the shape does not have:
 *
 *     CREATE TYPE app.envelope AS (foo ???);
 *
 * Inventing one (`app.envelope_foo`) would put a type in the schema that nobody
 * wrote. Give the shape a name: `type Content = { bar: string }`, `foo: Content`.
 *
 * Expected: `Envelope.foo` is an anonymous object type
 */
type Envelope = {
  foo: { bar: string };
};

export function innerBar(envelope: Envelope): string {
  return envelope.foo.bar;
}
