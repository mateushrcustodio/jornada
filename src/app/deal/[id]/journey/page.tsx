import { notFound } from "next/navigation";
import { CompactJourney } from "@/components/compact-journey";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ source?: string }>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  return (
    <CompactJourney
      id={Number(id)}
      source={query.source === "dashboard" ? "dashboard" : "card"}
    />
  );
}
