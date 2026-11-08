/** Work that nobody wants any more (its tile scrolled away or was re-rendered). Not a failure, and never retried as one. */
export class Abandoned extends Error {}

/**
 * A serial queue: `run` starts `work` once every earlier job has finished, unless `wanted()` is false by
 * then, in which case the job is skipped with `Abandoned` without ever starting. A job that throws does not
 * block the ones behind it. Any time limit belongs inside `work`, so it starts when the work does and
 * waiting in line never counts against it.
 */
export function createExclusive() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(wanted: () => boolean, work: () => Promise<T>): Promise<T> {
    const job = tail.then(() => { if (!wanted()) throw new Abandoned(); return work(); });
    tail = job.then(() => undefined, () => undefined);
    return job;
  };
}
