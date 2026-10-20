import { useEffect, useState } from "react";

// Caller supplies a stable loader. Ignore responses after navigation or retry.
export function useResource(loader) {
  const [state, setState] = useState({
    loading: true,
    data: null,
    error: null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ loading: true, data: null, error: null });
    Promise.resolve()
      .then(() => loader({signal: controller.signal}))
      .then(
        (data) => {
          if (active) setState({ loading: false, data, error: null });
        },
        (error) => {
          if (active) setState({ loading: false, data: null, error });
        },
      );
    return () => {
      active = false;
      controller.abort();
    };
  }, [loader, revision]);
  return { ...state, reload: () => setRevision((x) => x + 1) };
}
