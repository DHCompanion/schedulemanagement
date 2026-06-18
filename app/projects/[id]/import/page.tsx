import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ImportWizard } from "@/components/ImportWizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  return (
    <main className="mx-auto max-w-lg p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">
        ← {project.name}
      </Link>
      <h1 className="mb-4 mt-1 text-xl font-semibold">Import schedule (MS Project XML)</h1>
      <ImportWizard projectId={project.id} />
    </main>
  );
}
