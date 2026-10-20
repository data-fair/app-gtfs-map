import { ofetch } from 'ofetch'

// GTFS-RT: the feed is served without content-type, useFetch would decode it as text
export async function fetchBuffer (url: string): Promise<ArrayBuffer> {
  return await ofetch(url, { headers: { Accept: 'application/x-protobuf' }, responseType: 'arrayBuffer' })
}
