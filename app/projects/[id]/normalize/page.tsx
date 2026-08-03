import { redirect } from "next/navigation";

// Task Naming now lives on the Data Health tab (redesign phase 2).
export default async function NormalizePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/projects/${id}/data`);
}
