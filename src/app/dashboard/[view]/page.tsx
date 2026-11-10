import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!["movements", "stalled", "stages"].includes(view)) notFound();
  return <Dashboard view={view as "movements" | "stalled" | "stages"} />;
}
