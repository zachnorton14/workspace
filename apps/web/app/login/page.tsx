"use client";
import { useActionState } from "react";
import { login } from "../actions";

export default function Login() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main>
      <form action={action} className="card login">
        <h1 style={{ margin: 0, fontSize: 20 }}>School Hub</h1>
        <input type="password" name="token" placeholder="Hub token" autoFocus required autoComplete="current-password" />
        {state?.error && <p className="error">{state.error}</p>}
        <button className="primary" disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
      </form>
    </main>
  );
}
