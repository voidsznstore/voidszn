/** Name of the admin session cookie. Kept apart so the request proxy can read it without loading the database. */
export const ADMIN_COOKIE = "vs_admin";

/** Short-lived cookie between a correct password and a correct authenticator code. */
export const CHALLENGE_COOKIE = "vs_admin_step";
