"use client";

import { type FormEvent, startTransition, useActionState } from "react";

/**
 * Runs a server action from a form without clearing what was typed. By default
 * the browser empties a form once its action finishes, which is the wrong thing
 * when the action comes back with "fix this and try again".
 *
 * Put `action` and `onSubmit` on the form: with scripts running, `onSubmit` takes
 * over and keeps the fields; without them the plain action still works.
 */
export function useFormAction<State>(
  serverAction: (previous: Awaited<State>, form: FormData) => State | Promise<State>,
  initial: Awaited<State>,
) {
  const [state, action, pending] = useActionState(serverAction, initial);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  return { state, action, pending, onSubmit };
}
