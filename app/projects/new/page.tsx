function Field({ label, name, type = "text" }: { label: string; name: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <input name={name} type={type} className="rounded border border-slate-300 px-3 py-2" />
    </label>
  );
}

export default function NewProjectPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="mx-auto max-w-lg p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold">New Project</h1>
      {searchParams.error && <p className="mb-3 text-sm text-red-600">Name is required.</p>}
      <form action="/api/projects" method="post" className="flex flex-col gap-3">
        <Field label="Name *" name="name" />
        <Field label="Client" name="client" />
        <Field label="Sector (e.g. Healthcare)" name="sector" />
        <Field label="Building type" name="buildingType" />
        <Field label="Size (sq ft)" name="sizeSqFt" type="number" />
        <Field label="Contract value (USD)" name="contractValue" type="number" />
        <Field label="Region" name="region" />
        <Field label="Delivery method" name="deliveryMethod" />
        <button type="submit" className="mt-2 rounded bg-slate-900 px-3 py-2 font-medium text-white">
          Create Project
        </button>
      </form>
    </main>
  );
}
