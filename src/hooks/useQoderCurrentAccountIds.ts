import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getProviderCurrentAccountId } from '../services/providerCurrentAccountService';
import { useQoderAccountStore } from '../stores/useQoderAccountStore';
import { ACCOUNTS_CHANGED_EVENT, CURRENT_ACCOUNT_CHANGED_EVENT, type AccountSyncEventPayload } from '../utils/accountSyncEvents';
import { QODER_VARIANT_IDS, getQoderAccountVariantId, isQoderVariantId, type QoderAccount, type QoderVariantId } from '../types/qoder';

// 后端 provider_current_state 是权威；这里只保存各页面的只读投影。
export function useQoderCurrentAccountIds(accounts: QoderAccount[]) {
  const [currentIds, setCurrentIds] = useState<Record<QoderVariantId, string | null>>({
    qoder: null,
    qoder_app: null,
    qoder_cn_ide: null,
    qoder_cn_app: null,
  });

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const refresh = () => { void useQoderAccountStore.getState().fetchAccounts(); };
    for (const eventName of [ACCOUNTS_CHANGED_EVENT, CURRENT_ACCOUNT_CHANGED_EVENT]) {
      void listen<AccountSyncEventPayload>(eventName, ({ payload }) => {
        if (disposed || !payload || !isQoderVariantId(payload.platformId)) return;
        if (payload.sourceWindowLabel === getCurrentWindow().label) return;
        void useQoderAccountStore.getState().fetchAccounts({ allowEmpty: payload.reason === 'delete' });
      }).then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch((error) => console.error('Failed to subscribe to Qoder account changes', error));
    }
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled(QODER_VARIANT_IDS.map(getProviderCurrentAccountId)).then((results) => {
      if (cancelled) return;
      setCurrentIds((previous) => {
        const next = { ...previous };
        results.forEach((result, index) => {
          const variant = QODER_VARIANT_IDS[index];
          if (result.status === 'rejected') {
            console.error(`Failed to read current Qoder account: ${variant}`, result.reason);
            if (!accounts.some((account) =>
              account.id === next[variant] && getQoderAccountVariantId(account) === variant,
            )) next[variant] = null;
            return;
          }
          next[variant] = accounts.some((account) =>
            account.id === result.value && getQoderAccountVariantId(account) === variant,
          ) ? result.value : null;
        });
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [accounts]);

  return currentIds;
}
