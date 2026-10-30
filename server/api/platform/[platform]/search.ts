import { usePlatform } from "~~/server/platforms"

export default defineEventHandler(async (event) => {
  const platform = usePlatform(event.context.params?.platform)
  const requestUrl = new URL(event.req.url || '/', 'http://localhost')
  const keyword = requestUrl.searchParams.get('keyword') || ''
  return platform.search(keyword, Object.fromEntries(event.headers.entries()))
})
