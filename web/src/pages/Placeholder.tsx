export default function Placeholder({
  title,
  phase,
}: {
  title: string;
  phase: number;
}) {
  return (
    <div className="p-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Arrives in Phase {phase}. Skeleton is ready.
      </p>
    </div>
  );
}
