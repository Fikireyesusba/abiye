export function AuthCard({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{title}</h1>
        {intro && <p className="mb-6 text-sm text-muted-foreground">{intro}</p>}
        {!intro && <div className="mb-6" />}
        {children}
      </div>
    </div>
  );
}
