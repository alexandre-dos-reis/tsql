import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

// The same functions tsql compiled into the database, run here in the browser.
import { canAddTodo, todoLimit, type Plan } from "../functions/todos";

const api = "http://localhost:3000";

type User = { id: number; name: string; plan: Plan };
type Todo = { id: number; title: string };

const get = async <T,>(path: string): Promise<T> => (await fetch(`${api}${path}`)).json();

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number>();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    get<User[]>("/users?order=id").then((list) => {
      setUsers(list);
      setUserId(list[0]?.id);
    });
  }, []);

  const load = (id: number) => get<Todo[]>(`/todos?user_id=eq.${id}&order=id`).then(setTodos);
  useEffect(() => {
    if (userId !== undefined) void load(userId);
  }, [userId]);

  const user = users.find((u) => u.id === userId);
  if (!user) return null;

  async function add(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`${api}/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user!.id, title }),
    });
    setError(response.ok ? "" : (await response.json()).message);
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
        <button disabled={!canAddTodo(user.plan, todos.length)}>Add</button> {todos.length} of {todoLimit(user.plan)}
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
