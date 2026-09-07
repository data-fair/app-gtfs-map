import { ofetch } from 'ofetch'

export async function fetchJson <T = any> (url: string): Promise<T> {
  return await ofetch<T>(url, { headers: { Accept: 'application/json' } })
}

export async function fetchBuffer (url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { Accept: 'application/x-protobuf' } })
  if (!response.ok) {
    throw new Error(`Échec du téléchargement (${response.status}) : ${url}`)
  }
  return await response.arrayBuffer()
}
