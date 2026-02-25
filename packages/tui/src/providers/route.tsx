import { createContext, useContext, createSignal, type JSX, type Accessor } from "solid-js";

export type View =
  | { name: "task-list" }
  | { name: "task-detail"; taskId: string }
  | { name: "task-create" };

interface RouteContextValue {
  view: Accessor<View>;
  navigate: (view: View) => void;
  replace: (view: View, newHistory?: View[]) => void;
  back: () => void;
}

const RouteContext = createContext<RouteContextValue>();

export function RouteProvider(props: { children: JSX.Element }) {
  const [view, setView] = createSignal<View>({ name: "task-list" });
  const [history, setHistory] = createSignal<View[]>([]);

  function navigate(next: View) {
    setHistory((h) => [...h, view()]);
    setView(next);
  }

  function replace(next: View, newHistory?: View[]) {
    if (newHistory) {
      setHistory(newHistory);
    }
    setView(next);
  }

  function back() {
    const h = history();
    if (h.length === 0) return;
    const prev = h[h.length - 1];
    setHistory(h.slice(0, -1));
    setView(prev);
  }

  return (
    <RouteContext.Provider value={{ view, navigate, replace, back }}>
      {props.children}
    </RouteContext.Provider>
  );
}

export function useRoute(): RouteContextValue {
  const ctx = useContext(RouteContext);
  if (!ctx) throw new Error("useRoute must be used within RouteProvider");
  return ctx;
}
