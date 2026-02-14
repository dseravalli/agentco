import {
  createContext,
  useContext,
  createSignal,
  type JSX,
  type Accessor,
} from "solid-js"

interface ToastContextValue {
  message: Accessor<string>
  show: (msg: string, durationMs?: number) => void
}

const ToastContext = createContext<ToastContextValue>()

export function ToastProvider(props: { children: JSX.Element }) {
  const [message, setMessage] = createSignal("")
  let timer: ReturnType<typeof setTimeout> | undefined

  function show(msg: string, durationMs = 3000) {
    if (timer) clearTimeout(timer)
    setMessage(msg)
    timer = setTimeout(() => setMessage(""), durationMs)
  }

  return (
    <ToastContext.Provider value={{ message, show }}>
      {props.children}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within ToastProvider")
  return ctx
}
