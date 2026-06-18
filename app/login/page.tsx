export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="mb-4 text-xl font-semibold">Schedule Management</h1>
      {searchParams.error && <p className="mb-3 text-sm text-red-600">Incorrect password.</p>}
      <form action="/api/login" method="post" className="flex flex-col gap-3">
        <input
          type="password"
          name="password"
          placeholder="Shared password"
          className="rounded border border-slate-300 px-3 py-2"
          autoFocus
        />
        <button type="submit" className="rounded bg-slate-900 px-3 py-2 font-medium text-white">
          Enter
        </button>
      </form>
    </main>
  );
}
