const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '')

export const apiUrl = (path: string) => `${baseUrl}/api/v1/${path}`

export function request(path: string, options: RequestInit = {}) {
  return fetch(apiUrl(path), {
    cache: 'no-store', credentials: 'include', signal: AbortSignal.timeout(8000), ...options,
  })
}

export class FarmAccessDenied extends Error {}

export function checkFarmAuthentication(response: Response) {
  if (response.status === 401 || response.status === 403) {
    throw new FarmAccessDenied('Inicia sesión y comprueba que la finca sigue autorizada.')
  }
}
