import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
// The same functions tsql compiled into the database, run here in the browser.
import { canAddTodo, todoLimit, type Plan } from "../functions/todos";

// PostGraphile 5 names a table's `id` column `rowId` (its own `id` is the global node ID); the
// queries alias it back.
type User = { id: number; name: string; plan: Plan };
type Todo = { id: number; title: string };

async function graphql<T>(query: string, variables: object = {}): Promise<{ data?: T; errors?: { message: string }[] }> {
  const response = await fetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number>();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    graphql<{ allUsers: { nodes: User[] } }>("{ allUsers(orderBy: ROW_ID_ASC) { nodes { id: rowId name plan } } }").then(({ data }) => {
      setUsers(data?.allUsers.nodes ?? []);
      setUserId(data?.allUsers.nodes[0]?.id);
    });
  }, []);

  const load = (id: number) =>
    graphql<{ allTodos: { nodes: Todo[] } }>(
      "query ($id: Int!) { allTodos(condition: { userId: $id }, orderBy: ROW_ID_ASC) { nodes { id: rowId title } } }",
      { id },
    ).then(({ data }) => setTodos(data?.allTodos.nodes ?? []));
  useEffect(() => {
    if (userId !== undefined) void load(userId);
  }, [userId]);

  const user = users.find((u) => u.id === userId);
  if (!user) return null;

  async function add(event: FormEvent) {
    event.preventDefault();
    const { errors } = await graphql(
      "mutation ($todo: TodoInput!) { createTodo(input: { todo: $todo }) { todo { rowId } } }",
      { todo: { userId: user!.id, title } },
    );
    setError(errors?.[0]?.message ?? "");
    setTitle("");
    await load(user!.id);
  }

  return (
    <>
      <select value={user.id} onChange={(e) => setUserId(Number(e.target.value))}>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.plan})
          </option>
        ))}
      </select>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
      <form onSubmit={add}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A new todo" required />
        {/* Greyed out before anyone clicks; the database refuses it anyway if the page is bypassed. */}
        <button disabled={!canAddTodo(user.plan, todos.length)}>Add</button> {todos.length} of{" "}
        {todoLimit(user.plan)}
      </form>
      <p>{error}</p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
