import type { Integer } from "../../src/pgtypes";

/**
 * An array of a named object type is an array of its composite: `readonly TodoItem[]` is
 * `app.todo_item[]`. The loop variable is a local of the composite type, so its fields read like a
 * parameter's — directly or by destructuring — and the array can be passed on to another rule.
 */

export interface TodoItem {
  readonly title: string;
  readonly done: boolean;
  readonly estimate: Integer;
}

export function openEstimate(todos: readonly TodoItem[]): Integer {
  let total = 0;
  for (const todo of todos) {
    if (todo.done) {
      continue;
    }
    const { estimate } = todo;
    total += estimate;
  }
  return total;
}

export function openTodoCount(todos: readonly TodoItem[]): Integer {
  let remaining = 0;
  for (const todo of todos) {
    if (!todo.done) {
      remaining++;
    }
  }
  return remaining;
}

export const isOverloaded = (todos: readonly TodoItem[], limit: Integer): boolean =>
  openTodoCount(todos) > limit % 5 || todos.length === 10;
