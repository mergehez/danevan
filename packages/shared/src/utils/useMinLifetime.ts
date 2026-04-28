export async function withMinLifetime<T>(fn: () => Promise<T>, minLifetimeMs: number): Promise<T> {
    const now = Date.now();

    const result = await fn();

    const elapsed = Date.now() - now;
    if (elapsed < minLifetimeMs) {
        await new Promise((resolve) => setTimeout(resolve, minLifetimeMs - elapsed));
    }

    return result;
}
