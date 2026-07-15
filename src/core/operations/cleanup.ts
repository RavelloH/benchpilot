import { BenchPilotError } from "../errors/benchpilot-error.js";

export async function runCleanupWithGrace(
  cleanup: () => Promise<void> | void,
  name: string,
  timeoutMs = 5_000,
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve(cleanup()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BenchPilotError(
                "CLEANUP_TIMEOUT",
                5,
                `Cleanup timed out: ${name}`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
