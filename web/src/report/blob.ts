// A download link for JSON the page already holds, such as a private check's receipt: the server
// keeps no copy, so the browser hands it over itself.

import { useEffect, useState } from 'react';

export function useJsonUrl(data: unknown): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (data === undefined || data === null) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data]);
  return url;
}
