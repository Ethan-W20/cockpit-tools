import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { QoderVariantId } from '../types/qoder';
import {
  cancelQoderOfficialLogin,
  getQoderOfficialLoginStatus,
  startQoderOfficialLogin,
  type QoderOfficialLoginStatus,
} from '../services/qoderService';

const terminal = (status: QoderOfficialLoginStatus) =>
  ['completed', 'failed', 'cancelled'].includes(status.phase);

export function QoderOfficialLoginSection({ variant, onImported }: {
  variant: QoderVariantId;
  onImported: (accountId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<QoderOfficialLoginStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const isApp = variant === 'qoder_app' || variant === 'qoder_cn_app';

  useEffect(() => () => {
    generation.current += 1;
    const id = session.current;
    if (id) {
      void cancelQoderOfficialLogin(id).catch((cause) => {
        console.error('Failed to cancel Qoder official login', cause);
      });
    }
  }, []);

  const start = async () => {
    if (active.current) return;
    active.current = true;
    const attempt = ++generation.current;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      let next = await startQoderOfficialLogin(variant);
      if (attempt !== generation.current) {
        await cancelQoderOfficialLogin(next.sessionId);
        return;
      }
      session.current = next.sessionId;
      setStatus(next);
      while (!terminal(next)) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
        if (attempt !== generation.current) return;
        next = await getQoderOfficialLoginStatus(next.sessionId);
        if (attempt !== generation.current) return;
        setStatus(next);
      }
      session.current = null;
      if (next.phase === 'completed' && next.accountId) {
        // The backend already committed the account. A list failure cannot undo that success.
        try {
          await onImported(next.accountId);
        } catch {
          if (attempt === generation.current) {
            setError(t('qoder.officialLogin.refreshFailed', '账号已导入，但列表刷新失败，请手动刷新。'));
          }
        }
      }
    } catch (cause) {
      // Stop observation on a polling failure and let the backend clean the owned IDE profile.
      const id = session.current;
      if (id) {
        try { await cancelQoderOfficialLogin(id); }
        catch (cancelError) { console.error('Failed to cancel Qoder official login', cancelError); }
        session.current = null;
      }
      if (attempt === generation.current) setError(String(cause));
    } finally {
      if (attempt === generation.current) {
        active.current = false;
        setBusy(false);
      }
    }
  };

  const cancel = async () => {
    const id = session.current;
    if (!id) return;
    const attempt = generation.current;
    try {
      await cancelQoderOfficialLogin(id);
      if (attempt === generation.current) {
        setStatus((previous) => previous && !terminal(previous)
          ? { ...previous, phase: 'cancelling' } : previous);
      }
    } catch (cause) {
      if (attempt === generation.current) setError(String(cause));
    }
  };

  const phaseText = status ? t(`qoder.officialLogin.phases.${status.phase}`) : t('common.loading', '加载中...');
  return (
    <div className="add-section">
      <p className="section-desc">
        {t('qoder.officialLogin.desc', '由官方客户端生成授权地址并完成登录，Cockpit 在凭据落盘后自动导入账号。')}
      </p>
      <p className="oauth-hint">
        {isApp
          ? t('qoder.officialLogin.appHint', '将在当前官方客户端登录，客户端会保留新账号。若已有登录，请切换到另一个账号，或先退出登录，等待本窗口显示“已检测到退出登录”后重新登录。取消只停止监听，不关闭客户端。')
          : t('qoder.officialLogin.ideHint', '将打开临时空白实例。登录完成后自动关闭并清理临时实例，不改变默认实例的当前账号。')}
      </p>
      <button className="btn btn-primary btn-full" onClick={() => void start()} disabled={busy}>
        {busy ? <RefreshCw size={16} className="loading-spinner" /> : <Play size={16} />}
        {t('qoder.officialLogin.start', '打开官方客户端并登录')}
      </button>
      <div role="status" aria-live="polite">
        {(busy || status) && (
          <div className={`add-status ${status?.phase === 'completed' ? 'success' : status?.phase === 'failed' ? 'error' : busy ? 'loading' : ''}`}>
            {status?.phase === 'completed' ? <Check size={16} />
              : status?.phase === 'failed' ? <CircleAlert size={16} />
                : busy ? <RefreshCw size={16} className="loading-spinner" /> : null}
            <span>{phaseText}</span>
          </div>
        )}
      </div>
      {busy && session.current && (
        <button className="btn btn-secondary btn-full" onClick={() => void cancel()} disabled={status?.phase === 'cancelling' || status?.phase === 'cleaning'}>
          {t('common.cancel', '取消')}
        </button>
      )}
      {(error || status?.error || status?.cleanupWarning) && (
        <div className="add-status error" role="alert">
          <CircleAlert size={16} />
          <span>{[error, status?.error, status?.cleanupWarning].filter(Boolean).join(' · ')}</span>
        </div>
      )}
      <p className="oauth-hint">{t('qoder.officialLogin.timeout', '最长等待 10 分钟；关闭弹窗或切换标签会取消本次等待。')}</p>
    </div>
  );
}
