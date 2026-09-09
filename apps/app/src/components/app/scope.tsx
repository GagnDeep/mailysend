import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  type ApiClient,
  ApiClientError,
  type CurrentUserRecord,
  createApiClient,
  type Environment,
} from '~/lib/api-client.ts'
import { qk } from '~/lib/query.ts'

/**
 * Who is asking, on behalf of which workspace, in which environment.
 *
 * The environment is deliberately app-wide state rather than a URL segment or a
 * per-screen filter: `ms_live_` and `ms_test_` keys address two different sets
 * of data, and a dashboard where one screen is live and the next is test is a
 * way to send a real campaign by accident.
 */

interface AppScope {
  environment: Environment
  setEnvironment: (environment: Environment) => void
  workspaceId: string | undefined
  setWorkspaceId: (id: string) => void
  api: ApiClient
  user: CurrentUserRecord | undefined
  userLoading: boolean
  /** Set when `/v1/me` failed. `status === 401` means "not signed in", not "broken". */
  userError: ApiClientError | null
}

const AppScopeContext = createContext<AppScope | null>(null)

const ENV_STORAGE_KEY = 'mailysend.environment'
const WORKSPACE_STORAGE_KEY = 'mailysend.workspace'

const readStored = (key: string): string | null => {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Safari in private mode throws on localStorage. A dashboard that refuses
    // to render because it cannot remember a preference is the wrong trade.
    return null
  }
}

const writeStored = (key: string, value: string): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* see readStored */
  }
}

export const AppScopeProvider = ({ children }: { children: ReactNode }) => {
  // Both start at their server-rendered default and only adopt the stored value
  // after mount, because reading localStorage during render is a hydration
  // mismatch waiting for the first user who ever flipped the switch.
  const [environment, setEnvironmentState] = useState<Environment>('live')
  const [workspaceId, setWorkspaceIdState] = useState<string | undefined>(undefined)

  useEffect(() => {
    const stored = readStored(ENV_STORAGE_KEY)
    if (stored === 'test' || stored === 'live') setEnvironmentState(stored)
    const storedWorkspace = readStored(WORKSPACE_STORAGE_KEY)
    if (storedWorkspace) setWorkspaceIdState(storedWorkspace)
  }, [])

  const api = useMemo(
    () => createApiClient({ environment, workspaceId }),
    [environment, workspaceId],
  )

  const userQuery = useQuery({
    queryKey: qk.me(),
    queryFn: () => api.me(),
    staleTime: 5 * 60_000,
    retry: false,
  })

  const value = useMemo<AppScope>(
    () => ({
      environment,
      setEnvironment: (next) => {
        setEnvironmentState(next)
        writeStored(ENV_STORAGE_KEY, next)
      },
      workspaceId: workspaceId ?? userQuery.data?.workspaces[0]?.id,
      setWorkspaceId: (id) => {
        setWorkspaceIdState(id)
        writeStored(WORKSPACE_STORAGE_KEY, id)
      },
      api,
      user: userQuery.data,
      userLoading: userQuery.isLoading,
      userError: userQuery.error instanceof ApiClientError ? userQuery.error : null,
    }),
    [environment, workspaceId, api, userQuery.data, userQuery.isLoading, userQuery.error],
  )

  return <AppScopeContext.Provider value={value}>{children}</AppScopeContext.Provider>
}

export const useAppScope = (): AppScope => {
  const scope = useContext(AppScopeContext)
  if (!scope) throw new Error('useAppScope must be used inside <AppScopeProvider>')
  return scope
}

export const useApi = (): ApiClient => useAppScope().api
export const useEnvironment = (): Environment => useAppScope().environment
