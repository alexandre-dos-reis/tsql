// The same functions tsql compiled into the database, run here in the browser.
import { canAddTodo, todoLimit, type Plan } from "../functions/todos";

const api = "http://localhost:3000";

type User = { id: number; name: string; plan: Plan };
type Todo = { id: number; title: string };

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = element<HTMLSelectElement>("user");
const list = element<HTMLUListElement>("todos");
const form = element<HTMLFormElement>("add");
const title = element<HTMLInputElement>("title");
const submit = element<HTMLButtonElement>("submit");

const users: User[] = await (await fetch(`${api}/users?order=id`)).json();
select.replaceChildren(...users.map((user) => new Option(`${user.name} (${user.plan})`, String(user.id))));

const current = () => users.find((user) => user.id === Number(select.value))!;

async function render(): Promise<void> {
  const user = current();
  const todos: Todo[] = await (await fetch(`${api}/todos?user_id=eq.${user.id}&order=id`)).json();
  list.replaceChildren(...todos.map((todo) => Object.assign(document.createElement("li"), { textContent: todo.title })));
  element("limit").textContent = `${todos.length} of ${todoLimit(user.plan)}`;
  // Greyed out before anyone clicks; the database refuses it anyway if the page is bypassed.
  submit.disabled = !canAddTodo(user.plan, todos.length);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch(`${api}/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: current().id, title: title.value }),
  });
  element("error").textContent = response.ok ? "" : (await response.json()).message;
  title.value = "";
  await render();
});

select.addEventListener("change", render);
await render();
