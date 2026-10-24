export class AuthRequestError extends Error {
  constructor(public status: number) {
    super('Authentication request failed');
  }
}

export async function postAuth(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new AuthRequestError(response.status);
  return response.json();
}
