import { createContext, useContext, onCleanup, type JSX } from "solid-js"
import { ApiClient } from "../lib/api.js"
import { WSClient } from "../lib/ws.js"

export interface SDK {
  api: ApiClient
  ws: WSClient
}

const SDKContext = createContext<SDK>()

export function SDKProvider(props: { baseUrl: string; children: JSX.Element }) {
  const api = new ApiClient(props.baseUrl)
  const ws = new WSClient(props.baseUrl)

  ws.connect()
  onCleanup(() => ws.disconnect())

  return (
    <SDKContext.Provider value={{ api, ws }}>
      {props.children}
    </SDKContext.Provider>
  )
}

export function useSDK(): SDK {
  const ctx = useContext(SDKContext)
  if (!ctx) throw new Error("useSDK must be used within SDKProvider")
  return ctx
}
