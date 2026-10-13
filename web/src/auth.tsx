import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchMe, loadUser, signIn, signOut, signUp, type User } from './api/auth'
import { isDemo } from './api/http'
import { useLang } from './i18n'

interface AuthCtx {
  user: User | null
  /** false until the session check has answered (server mode). */
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
  setUser: (u: User | null) => void
}

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: true,
  login: async () => {},
  register: async () => {},
  logout: () => {},
  setUser: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const { lang } = useLang()
  const [user, setUser] = useState<User | null>(loadUser)
  const [ready, setReady] = useState(isDemo)

  useEffect(() => {
    if (isDemo) return
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  const value: AuthCtx = {
    user,
    ready,
    setUser,
    login: async (email, password) => setUser(await signIn(email, password)),
    register: async (name, email, password) => setUser(await signUp(name, email, password, lang)),
    logout: () => {
      void signOut()
      setUser(null)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(Ctx)
