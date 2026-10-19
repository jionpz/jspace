// application/concurrency.ts — small bounded-concurrency primitive shared by
// read-only audits. It preserves input order and never starts more than `limit`
// workers, so a large gbrain inventory cannot create an unbounded read burst.
export async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const width = Math.max(1, Math.min(limit, values.length));
  const out = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: width }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      out[index] = await fn(values[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}
