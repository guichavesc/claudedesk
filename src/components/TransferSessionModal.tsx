import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Profile, providerDisplayName, profileProvider } from '../types';

interface TransferSessionModalProps {
  sourceSessionId: string;
  sourceProfileId: string;
  profiles: Profile[];
  reason?: 'limit' | 'manual';
  onClose: () => void;
  onTransferred: (newSessionId: string) => void;
}

export function TransferSessionModal({
  sourceSessionId,
  sourceProfileId,
  profiles,
  reason = 'manual',
  onClose,
  onTransferred,
}: TransferSessionModalProps) {
  const source = profiles.find((p) => p.id === sourceProfileId);
  const targets = profiles.filter((p) => p.id !== sourceProfileId);
  const [targetProfileId, setTargetProfileId] = useState(targets[0]?.id || '');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [cliError, setCliError] = useState<string | null>(null);
  const [keepArchived, setKeepArchived] = useState(true);

  const target = profiles.find((p) => p.id === targetProfileId);

  useEffect(() => {
    if (!targetProfileId) return;
    let cancelled = false;
    (async () => {
      setLoadingModels(true);
      setCliError(null);
      try {
        const dest = profiles.find((p) => p.id === targetProfileId);
        const provider = profileProvider(dest);
        if (provider !== 'claude') {
          const cli = await window.api.checkProviderCli(provider);
          if (cancelled) return;
          if (!cli.available) {
            setCliError(cli.message || `${providerDisplayName(provider)} CLI not found`);
            setModels([]);
            setModel('');
            return;
          }
        }
        const result = await window.api.getAvailableModels(targetProfileId);
        if (cancelled) return;
        const list = result.models?.length ? result.models : [];
        setModels(list);
        setModel(list[0] || '');
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetProfileId, profiles]);

  const handleTransfer = async () => {
    if (!targetProfileId || loading) return;
    setLoading(true);
    try {
      const result = await window.api.transferSession({
        sourceSessionId,
        targetProfileId,
        model: model || undefined,
      });
      if (!result.success || !result.sessionId) {
        alert(result.message || 'Transfer failed');
        return;
      }
      onTransferred(result.sessionId);
    } catch (e: any) {
      alert(e?.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cd-scrim" onClick={onClose}>
      <div className="cd-dialog w-[520px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-[18px] pb-3.5 border-b-2 border-[var(--strong)] flex flex-col gap-1">
          <span className="text-[19px] font-extrabold tracking-tight">Migrate session</span>
          <span className="font-mono text-[10.5px] text-[var(--dim)]">
            {reason === 'limit' ? 'Usage limit reached — continue on another profile.' : 'Hand this conversation to another agent.'}
          </span>
        </div>
        <div className="px-5 py-[18px] flex flex-col gap-4">
          {targets.length === 0 ? (
            <p className="text-[13px] text-[var(--dim)]">Create another profile first.</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
                <div className="border border-[var(--rule)] bg-[var(--surface)] p-3 flex flex-col gap-1">
                  <span className="cd-kicker">From</span>
                  <span className="text-[13px] font-semibold">
                    {providerDisplayName(profileProvider(source))} · {source?.name}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--dim)]">profile {source?.name}</span>
                </div>
                <div className="flex items-center font-mono text-[16px] text-[var(--accent)]">→</div>
                <div className="border-2 border-[var(--accent)] bg-[var(--tint)] p-3 flex flex-col gap-1">
                  <span className="font-mono text-[9px] tracking-widest text-[var(--accent)]">TO</span>
                  <span className="text-[13px] font-semibold">
                    {providerDisplayName(profileProvider(target))} · {target?.name}
                  </span>
                  <select
                    value={targetProfileId}
                    onChange={(e) => setTargetProfileId(e.target.value)}
                    className="mt-1 bg-transparent font-mono text-[10px] text-[var(--dim)] outline-none"
                  >
                    {targets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({providerDisplayName(profileProvider(p))})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="cd-kicker">Model</span>
                {cliError ? (
                  <p className="text-[12px] text-[var(--delfg)]">{cliError}</p>
                ) : (
                  <select value={model} onChange={(e) => setModel(e.target.value)} disabled={loadingModels} className="cd-select">
                    {loadingModels ? <option>Loading…</option> : models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="cd-kicker">What carries over</span>
                <div className="border border-[var(--rule)] divide-y divide-[var(--rule)] text-[12.5px]">
                  <div className="flex items-center gap-2.5 px-3 py-2.5"><span className="text-[var(--accent)] font-mono">✓</span><span className="flex-1">Conversation transcript</span><span className="font-mono text-[10px] text-[var(--dim)]">summarised</span></div>
                  <div className="flex items-center gap-2.5 px-3 py-2.5"><span className="text-[var(--accent)] font-mono">✓</span><span className="flex-1">Working tree &amp; branch</span><span className="font-mono text-[10px] text-[var(--dim)]">unchanged</span></div>
                  <div className="flex items-center gap-2.5 px-3 py-2.5"><span className="text-[var(--accent)] font-mono">✓</span><span className="flex-1">Session recap</span><span className="font-mono text-[10px] text-[var(--dim)]">handed as brief</span></div>
                </div>
              </div>

              <label className="flex items-center gap-2 font-mono text-[11px] text-[var(--dim)]">
                <input type="checkbox" checked={keepArchived} onChange={(e) => setKeepArchived(e.target.checked)} className="accent-[var(--accent)]" />
                Keep the original session archived
              </label>
            </>
          )}
        </div>
        <div className="border-t-2 border-[var(--strong)] px-5 py-3.5 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className="cd-btn-ghost">Cancel</button>
          <button
            type="button"
            onClick={handleTransfer}
            disabled={!targetProfileId || loading || targets.length === 0 || !!cliError}
            className="cd-btn-primary flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Migrate to {target ? providerDisplayName(profileProvider(target)) : 'profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
