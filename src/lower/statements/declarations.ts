/**
 * Variable declarations, including destructuring.
 */
import {
  NodeFlags,
  SyntaxKind,
  type BindingElement,
  type Expression,
  type Identifier,
  type Node,
  type ObjectBindingPattern,
  type VariableDeclarationList,
  type VariableStatement,
} from "typescript/unstable/ast";

import { CompileError } from "@/errors";
import { isArray, isComposite, type ExprIR, type PgType, type StmtIR, STMT, EXPR } from "@/ir";
import { coerce, requireAssignable } from "@/lower/coerce";
import { readPath, resolveAccess } from "@/lower/expressions/access";
import { lowerExpr } from "@/lower/expressions/expr";
import { uniqueName, type State } from "@/lower/state";
import { toSnakeCase } from "@/names";
import { mapInferredType, mapTypeNode } from "@/typemap";

export async function lowerVariableStatement(node: VariableStatement, s: State): Promise<StmtIR[]> {
  return lowerDeclarationList(node.declarationList, node, s);
}

export async function lowerDeclarationList(list: VariableDeclarationList, node: Node, s: State): Promise<StmtIR[]> {
  const flags = list.flags;
  const kind = flags & NodeFlags.Const ? "const" : flags & NodeFlags.Let ? "let" : undefined;
  if (!kind) {
    throw CompileError.at(
      node,
      "`var` is not supported: it is function-scoped and hoisted. Use `const`, or `let` for a value that changes.",
    );
  }

  const out: StmtIR[] = [];
  for (const declaration of list.declarations) {
    if (declaration.name.kind === SyntaxKind.ObjectBindingPattern) {
      out.push(...(await lowerDestructuring(declaration.name as ObjectBindingPattern, declaration, kind, s)));
      continue;
    }
    if (declaration.name.kind !== SyntaxKind.Identifier) {
      throw CompileError.at(
        declaration.name,
        "Array destructuring is not supported: reading by position is not part of the compiled subset. Iterate with `for (const x of xs)`.",
      );
    }
    const tsName = (declaration.name as Identifier).text;
    if (!declaration.initializer) {
      throw CompileError.at(declaration, `\`${tsName}\` must be initialised.`);
    }
    if (s.scope.has(tsName)) {
      throw CompileError.at(declaration.name, `\`${tsName}\` shadows an existing binding.`);
    }

    // Without an annotation, a `let` takes the type of its initial value, like a
    // `const`. TypeScript widens `let total = 0` to `number`; here it is an
    // `integer`, and assigning it 0.5 later is refused with a hint to annotate —
    // never silently rounded.
    const annotated = declaration.type ? await mapTypeNode(declaration.type, s) : undefined;
    const init = await lowerExpr(declaration.initializer, s, annotated);
    const declared = annotated ?? (await inferLocalType(init, declaration.initializer, s));
    requireAssignable(init.type, declared, declaration.initializer, `initialiser for \`${tsName}\``);

    const sqlName = uniqueName(toSnakeCase(tsName), s.used);
    s.scope.set(tsName, { sqlName, type: declared, kind });
    s.locals.push({ tsName, sqlName, type: declared });
    out.push({ kind: STMT.assign, sqlName, expr: coerce(init, declared) });
  }
  return out;
}

/**
 * `const { plan, count } = sub;` is `const plan = sub.plan; const count = sub.count;`
 * — field reads the compiler already does, one local per name. Nested patterns
 * read nested fields (`const { customer: { tier } } = basket` reads
 * `basket.customer.tier`), and `{ plan: p }` renames.
 *
 * The source is read once, as in JavaScript: a call or an object literal is held
 * in a local first. Defaults and `...rest` are refused — a default would need a
 * check for `undefined`, which has no SQL equivalent, and a rest object has no
 * named composite type to become.
 */
async function lowerDestructuring(
  pattern: ObjectBindingPattern,
  declaration: VariableStatement["declarationList"]["declarations"][number],
  kind: "const" | "let",
  s: State,
): Promise<StmtIR[]> {
  if (!declaration.initializer) throw CompileError.at(declaration, "A destructuring must be initialised.");
  if (declaration.type) {
    throw CompileError.at(
      declaration.type,
      "A type annotation on a destructuring is not supported; annotate the object being destructured instead.",
    );
  }

  const resolved = await resolveAccess(declaration.initializer, s);
  if (!resolved || !isComposite(resolved.base.type)) {
    throw CompileError.at(
      declaration.initializer,
      `Only an object of a named type can be destructured; \`${declaration.initializer.getText()}\` is not one.`,
    );
  }

  const out: StmtIR[] = [];
  let base = resolved.base;
  if (base.kind !== EXPR.ref) {
    const sqlName = uniqueName("destructured", s.used);
    s.locals.push({ tsName: sqlName, sqlName, type: base.type });
    out.push({ kind: STMT.assign, sqlName, expr: base });
    base = { kind: EXPR.ref, sqlName, type: base.type };
  }

  const bind = async (elements: readonly BindingElement[], prefix: readonly string[]): Promise<void> => {
    for (const element of elements) {
      if (element.dotDotDotToken) {
        throw CompileError.at(element, "`...rest` in a destructuring is not supported: the rest has no named type.");
      }
      if (element.initializer) {
        throw CompileError.at(
          element.initializer,
          "Default values in a destructuring are not supported: they apply on `undefined`, which has no SQL equivalent.",
        );
      }
      const name = element.name;
      if (!name) throw CompileError.at(element, "Only plain property names can be destructured.");
      const key = element.propertyName ?? name;
      if (key.kind !== SyntaxKind.Identifier) {
        throw CompileError.at(key, "Only plain property names can be destructured.");
      }
      const path = [...prefix, (key as Identifier).text];

      if (name.kind === SyntaxKind.ObjectBindingPattern) {
        await bind((name as ObjectBindingPattern).elements, path);
        continue;
      }
      if (name.kind !== SyntaxKind.Identifier) {
        throw CompileError.at(
          name,
          "Array destructuring is not supported: reading by position is not part of the compiled subset.",
        );
      }

      const field = readPath(base, path, element);

      const tsName = (name as Identifier).text;
      if (s.scope.has(tsName)) {
        throw CompileError.at(name, `\`${tsName}\` shadows an existing binding.`);
      }
      const sqlName = uniqueName(toSnakeCase(tsName), s.used);
      s.scope.set(tsName, { sqlName, type: field.type, kind });
      s.locals.push({ tsName, sqlName, type: field.type });
      out.push({ kind: STMT.assign, sqlName, expr: field });
    }
  };

  await bind(pattern.elements, resolved.path);
  return out;
}

/**
 * A `const` without an annotation takes the type the expression produced.
 * The checker is consulted too, so that an annotation-free `const` whose
 * TypeScript type we could not represent is still rejected with a good message.
 */
async function inferLocalType(init: ExprIR, at: Expression, s: State): Promise<PgType> {
  // An array's type is the one lowering built. The checker would see `[1, 2]`
  // as a mutable `number[]`, which is harmless in a local: every way to mutate
  // it — a method, an element or a `length` assignment — is refused anyway.
  if (isArray(init.type)) return init.type;
  const checked = await s.checker.getTypeAtLocation(at);
  if (checked) await mapInferredType(checked, at, s);
  return init.type;
}
