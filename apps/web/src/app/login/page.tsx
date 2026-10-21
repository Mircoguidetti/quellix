import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Quellix" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Quellix</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Use your Google account or get a magic link by email.
        </p>
      </div>
      <LoginForm />
    </main>
  );
}
