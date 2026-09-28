import {
  QoderAccount,
  getQoderAccountDisplayEmail,
  getQoderPlanBadge,
  getQoderUsage,
  getQoderAccountVariantId,
} from '../types/qoder';
import * as qoderService from '../services/qoderService';
import { getProviderCurrentAccountId } from '../services/providerCurrentAccountService';
import { createProviderAccountStore } from './createProviderAccountStore';

const QODER_ACCOUNTS_CACHE_KEY = 'agtools.qoder.accounts.cache.v2';
const QODER_CURRENT_ACCOUNT_ID_KEY = 'agtools.qoder.current_account_id';

// 旧缓存可能含完整 auth.v1.dat 载荷；升级时主动删除，随后由脱敏的 IPC 列表重建。
try {
  localStorage.removeItem('agtools.qoder.accounts.cache');
} catch {
  // 缓存不可用时由 store 继续从后端读取。
}

export const useQoderAccountStore = createProviderAccountStore<QoderAccount>(
  QODER_ACCOUNTS_CACHE_KEY,
  {
    listAccounts: qoderService.listQoderAccounts,
    deleteAccount: qoderService.deleteQoderAccount,
    deleteAccounts: qoderService.deleteQoderAccounts,
    injectAccount: qoderService.injectQoderAccount,
    refreshToken: qoderService.refreshQoderToken,
    refreshAllTokens: qoderService.refreshAllQoderVariants,
    importFromJson: qoderService.importQoderFromJson,
    exportAccounts: qoderService.exportQoderAccounts,
    updateAccountTags: qoderService.updateQoderAccountTags,
  },
  {
    getDisplayEmail: getQoderAccountDisplayEmail,
    getPlanBadge: getQoderPlanBadge,
    getUsage: getQoderUsage,
    getAccountPlatformId: getQoderAccountVariantId,
  },
  {
    platformId: 'qoder',
    silentMutationRefresh: true,
    currentAccountIdKey: QODER_CURRENT_ACCOUNT_ID_KEY,
    // 通用 store 的单值当前账号固定为国际 IDE；其他变体从后端映射读取。
    acceptEmptyCurrentAccountId: true,
    resolveCurrentAccountId: () => getProviderCurrentAccountId('qoder'),
  },
);

// 定时任务刷新全部变体；页面手动批量刷新仍通过服务按当前标签页变体执行。
export async function refreshAllQoderVariants(): Promise<void> {
  await useQoderAccountStore.getState().refreshAllTokens();
}
