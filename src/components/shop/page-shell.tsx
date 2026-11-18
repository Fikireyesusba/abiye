export function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {children}
    </div>
  );
}
