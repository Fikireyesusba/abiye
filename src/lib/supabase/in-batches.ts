/** Runs a `.in("id", …)` query in small batches (the ids travel in the request URL) and joins the rows. */
export async function inBatches<T>(ids: string[], run: (batch: string[]) => PromiseLike<{ data: T[] | null }>, size = 80): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...((await run(ids.slice(i, i + size))).data ?? []));
  return out;
}
