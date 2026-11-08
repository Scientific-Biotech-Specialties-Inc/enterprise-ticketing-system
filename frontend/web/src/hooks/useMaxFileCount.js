import { useEffect, useState } from 'react';
import { getFileLimitsConfig } from '@/services/configurationService';

const DEFAULT_MAX_FILE_COUNT = 5;

/**
 * Returns the superadmin configured maximum number of files per upload
 * (configuration-service file_limits.maxFileCount). Falls back to 5 until the
 * live value loads or if it cannot be fetched. The server enforces the same limit.
 */
export default function useMaxFileCount() {
  const [maxFileCount, setMaxFileCount] = useState(DEFAULT_MAX_FILE_COUNT);

  useEffect(() => {
    let active = true;
    getFileLimitsConfig()
      .then((cfg) => {
        const count = Number(cfg?.maxFileCount);
        if (active && count > 0) setMaxFileCount(count);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return maxFileCount;
}
