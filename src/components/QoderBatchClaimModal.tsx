import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Gift, X, Check, RotateCw, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  QoderAccount,
  QODER_VARIANT_DISPLAY_NAMES,
  getQoderAccountVariantId,
  getQoderAccountDisplayEmail,
  resolveQoderRewardStatus,
} from '../types/qoder';
import * as qoderService from '../services/qoderService';
import { useModalScrollLock } from '../hooks/useModalScrollLock';
import { useEscCloseTopmost } from '../hooks/useEscClose';
import './QoderBatchClaimModal.css';

interface QoderBatchClaimModalProps {
  accounts: QoderAccount[];
  onClose: () => void;
  onFinished: () => Promise<void>;
  maskAccountText: (text: string) => string;
}

type ClaimStatus = 'pending' | 'running' | 'success' | 'already' | 'failed';

interface AccountClaimState {
  status: ClaimStatus;
  amount?: number;
  message?: string;
}

export function QoderBatchClaimModal({
  accounts,
  onClose,
  onFinished,
  maskAccountText,
}: QoderBatchClaimModalProps) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const unclaimeds = accounts.filter((a) => resolveQoderRewardStatus(a) !== 'claimed');
    const defaults = unclaimeds.length > 0 ? unclaimeds : accounts;
    return new Set(defaults.map((a) => a.id));
  });
  const [running, setRunning] = useState(false);
  const [currentClaimingId, setCurrentClaimingId] = useState<string | null>(null);
  const [claimStates, setClaimStates] = useState<Record<string, AccountClaimState>>({});
  const [summary, setSummary] = useState<{ success: number; already: number; failed: number; pending: number } | null>(null);
  const [stopRequested, setStopRequested] = useState(false);

  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);

  useModalScrollLock(true);
  useEscCloseTopmost(true, () => {
    if (!running) {
      onClose();
    }
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < accounts.length;

  const handleToggleSelectAll = () => {
    if (running) return;
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(accounts.map((a) => a.id)));
    }
  };

  const handleToggleAccount = (id: string) => {
    if (running) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleStartBatchClaim = useCallback(async () => {
    if (runningRef.current || selectedIds.size === 0) return;
    runningRef.current = true;
    stopRequestedRef.current = false;
    setStopRequested(false);
    setRunning(true);
    setSummary(null);

    const targetAccounts = accounts.filter((a) => selectedIds.has(a.id));
    const initStates: Record<string, AccountClaimState> = {};
    for (const a of targetAccounts) {
      initStates[a.id] = { status: 'pending' };
    }
    setClaimStates(initStates);

    let successCount = 0;
    let alreadyCount = 0;
    let failedCount = 0;
    let completedCount = 0;

    for (const account of targetAccounts) {
      if (!mountedRef.current || stopRequestedRef.current) break;

      setCurrentClaimingId(account.id);
      setClaimStates((prev) => ({
        ...prev,
        [account.id]: { status: 'running' },
      }));

      try {
        const result = await qoderService.claimQoderReward(account.id);
        if (!mountedRef.current) break;
        completedCount++;

        if (result.success && !result.replayed) {
          successCount++;
          setClaimStates((prev) => ({
            ...prev,
            [account.id]: {
              status: 'success',
              amount: result.amount,
              message: result.message,
            },
          }));
        } else if (result.success && result.replayed) {
          alreadyCount++;
          setClaimStates((prev) => ({
            ...prev,
            [account.id]: {
              status: 'already',
              amount: result.amount,
              message: result.message,
            },
          }));
        } else {
          failedCount++;
          setClaimStates((prev) => ({
            ...prev,
            [account.id]: {
              status: 'failed',
              message: result.message || t('qoder.claimReward.statusFailed', '失败'),
            },
          }));
        }
      } catch (err) {
        if (!mountedRef.current) break;
        completedCount++;
        failedCount++;
        setClaimStates((prev) => ({
          ...prev,
          [account.id]: {
            status: 'failed',
            message: String(err),
          },
        }));
      }
    }

    if (mountedRef.current) {
      // 队列已结束，列表同步不应继续锁住关闭入口。
      setRunning(false);
      runningRef.current = false;
      setCurrentClaimingId(null);
      setSummary({ success: successCount, already: alreadyCount, failed: failedCount, pending: targetAccounts.length - completedCount });
      try {
        await onFinished();
      } catch (err) {
        console.error('刷新账号列表失败:', err);
      }
    }
  }, [accounts, onFinished, selectedIds, t]);

  const handleStopBatchClaim = () => {
    stopRequestedRef.current = true;
    setStopRequested(true);
  };

  return createPortal(
    <div className="qoder-batch-claim-overlay" onClick={running ? undefined : onClose}>
      <div className="qoder-batch-claim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qoder-batch-claim-header">
          <div className="qoder-batch-claim-heading">
            <div className="qoder-batch-claim-icon">
              <Gift size={20} />
            </div>
            <h2>{t('qoder.claimReward.modalTitle', '一键领取每日 100 积分')}</h2>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={running}
            aria-label={t('common.close', '关闭')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="qoder-batch-claim-body">
          <p className="qoder-batch-claim-desc">
            {t(
              'qoder.claimReward.modalDesc',
              '可勾选需要领取的 Qoder 账号，一键领取每日 100 积分福利（活动每天 10:00 刷新）。领取完成后会自动同步最新配额。'
            )}
          </p>

          <div className="qoder-batch-claim-toolbar">
            <label className="qoder-batch-claim-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = isIndeterminate;
                }}
                onChange={handleToggleSelectAll}
                disabled={running || accounts.length === 0}
              />
              <span>
                {t('qoder.claimReward.selectAll', '全选')} (
                {t('qoder.claimReward.selectedCount', '已选 {{selected}} / {{total}} 个账号', {
                  selected: selectedIds.size,
                  total: accounts.length,
                })}
                )
              </span>
            </label>
            {running && currentClaimingId && (
              <span className="qoder-batch-claim-active-label">
                <RotateCw size={12} className="loading-spinner" />
                {t('qoder.claimReward.claiming', '领取中...')}
              </span>
            )}
          </div>

          <ul className="qoder-batch-claim-list">
            {accounts.map((account) => {
              const isSelected = selectedIds.has(account.id);
              const state = claimStates[account.id];
              const variantId = getQoderAccountVariantId(account);
              const variantLabel = QODER_VARIANT_DISPLAY_NAMES[variantId] || 'Qoder';
              const displayEmail = maskAccountText(getQoderAccountDisplayEmail(account));

              return (
                <li
                  key={account.id}
                  className="qoder-batch-claim-row"
                  onClick={() => handleToggleAccount(account.id)}
                  style={{ cursor: running ? 'default' : 'pointer' }}
                >
                  <div className="qoder-batch-claim-account-info">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleAccount(account.id)}
                      disabled={running}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="qoder-batch-claim-meta">
                      <div className="qoder-batch-claim-email-line">
                        <span className="qoder-batch-claim-email" title={displayEmail}>
                          {displayEmail}
                        </span>
                        <span className="qoder-batch-claim-badge">{variantLabel}</span>
                      </div>
                      <span className="qoder-batch-claim-quota">
                        {t('qoder.usageOverview.includedCredits', '额度')}:{' '}
                        {account.credits_remaining !== undefined && account.credits_remaining !== null
                          ? `${account.credits_remaining} / ${account.credits_total ?? '--'}`
                          : '-- / --'}
                      </span>
                    </div>
                  </div>

                  <div className="qoder-batch-claim-status-area">
                    {state?.status === 'running' && (
                      <span className="qoder-batch-claim-status running">
                        <RotateCw size={12} className="loading-spinner" />
                        {t('qoder.claimReward.claiming', '领取中...')}
                      </span>
                    )}
                    {state?.status === 'success' && (
                      <span className="qoder-batch-claim-status success">
                        <Check size={13} />
                        {state.amount == null ? t('common.success', '成功') : `+${state.amount}`}
                      </span>
                    )}
                    {state?.status === 'already' && (
                      <span className="qoder-batch-claim-status already">
                        <Check size={13} />
                        {t('qoder.claimReward.statusAlreadyClaimed', '今日已领')}
                      </span>
                    )}
                    {state?.status === 'failed' && (
                      <span className="qoder-batch-claim-status failed" title={state.message}>
                        <AlertCircle size={13} />
                        {t('qoder.claimReward.statusFailed', '失败')}
                      </span>
                    )}
                    {(!state || state.status === 'pending') && (() => {
                      const rewardStatus = resolveQoderRewardStatus(account);
                      if (rewardStatus === 'claimed') {
                        return (
                          <span className="qoder-batch-claim-status already">
                            <Gift size={12} />
                            {t('qoder.claimReward.statusAlreadyClaimed', '今日已领')}
                          </span>
                        );
                      }
                      if (rewardStatus === 'claimable') {
                        return (
                          <span className="qoder-batch-claim-status claimable">
                            <Gift size={12} />
                            {t('qoder.claimReward.badgeClaimable', '可领100')}
                          </span>
                        );
                      }
                      if (rewardStatus === 'none') {
                        return (
                          <span className="qoder-batch-claim-status none">
                            <Gift size={12} />
                            {t('qoder.claimReward.statusNone', '无活动')}
                          </span>
                        );
                      }
                      return (
                        <span className="qoder-batch-claim-status pending">
                          {t('qoder.claimReward.statusPending', '待领取')}
                        </span>
                      );
                    })()}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="qoder-batch-claim-footer">
          <div className="qoder-batch-claim-summary">
            {summary && (
              <span>
                {t('qoder.claimReward.batchFinishedSummary', '完成：{{success}} 成功，{{already}} 已领，{{failed}} 失败', {
                  success: summary.success,
                  already: summary.already,
                  failed: summary.failed,
                })}
                {summary.pending > 0 && ` · ${summary.pending} ${t('qoder.claimReward.statusPending', '待领取')}`}
              </span>
            )}
          </div>
          <div className="qoder-batch-claim-footer-btns">
            <button
              className="btn btn-secondary"
              onClick={running ? handleStopBatchClaim : onClose}
              disabled={running && stopRequested}
            >
              {running ? t('common.stop', '停止') : summary ? t('common.close', '关闭') : t('common.cancel', '取消')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleStartBatchClaim}
              disabled={running || selectedIds.size === 0}
            >
              {running ? (
                <>
                  <RotateCw size={14} className="loading-spinner" />
                  {t('qoder.claimReward.claiming', '领取中...')}
                </>
              ) : (
                <>
                  <Gift size={14} />
                  {summary
                    ? t('qoder.claimReward.reclaim', '重新领取')
                    : `${t('qoder.claimReward.startClaim', '一键领取')} (${selectedIds.size})`}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
