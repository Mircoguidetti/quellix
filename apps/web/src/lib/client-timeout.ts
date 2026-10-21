/** Rejects when a server action has not answered in time, so no button hangs forever. */
export function clientTimeout<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export const NETWORK_ERROR = "We could not reach Quellix. Check your connection and try again.";
