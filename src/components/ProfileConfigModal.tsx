import React, { useEffect, useState } from 'react';
import {
  X, Server, Blocks, Plus, Trash2, Pencil, Loader2, RefreshCw, Store, Package, Check,
} from 'lucide-react';
import { Profile, McpServerEntry, McpServerType } from '../types';

interface ProfileConfigModalProps {
  profile: Profile;
  onClose: () => void;
}

type Tab = 'mcp' | 'plugins';

function parseLines(text: string): string[] {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function parseKeyValueLines(text: string, sep: string): Record<string, string> {
  const result: Record<string, string> = {};
  parseLines(text).forEach(line => {
    const idx = line.indexOf(sep);
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + sep.length).trim();
    if (key) result[key] = value;
  });
  return result;
}

function stringifyKeyValue(obj: Record<string, string> | undefined, sep: string): string {
  if (!obj) return '';
  return Object.entries(obj).map(([k, v]) => `${k}${sep}${v}`).join('\n');
}

const EMPTY_FORM = {
  name: '',
  type: 'stdio' as McpServerType,
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
};

function McpServersTab({ profile }: { profile: Profile }) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await window.api.getProfileMcpServers(profile.id);
    setServers(res.servers || []);
    setError(res.error || '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile.id]);

  const openAddForm = () => {
    setEditingName(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setIsFormOpen(true);
  };

  const openEditForm = (server: McpServerEntry) => {
    setEditingName(server.name);
    setForm({
      name: server.name,
      type: server.type,
      command: server.command || '',
      argsText: (server.args || []).join('\n'),
      envText: stringifyKeyValue(server.env, '='),
      url: server.url || '',
      headersText: stringifyKeyValue(server.headers, ': '),
    });
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { setFormError('Server name is required'); return; }

    const config: Omit<McpServerEntry, 'name'> = form.type === 'stdio'
      ? {
          type: 'stdio',
          command: form.command.trim(),
          args: parseLines(form.argsText),
          env: parseKeyValueLines(form.envText, '='),
        }
      : {
          type: form.type,
          url: form.url.trim(),
          headers: parseKeyValueLines(form.headersText, ':'),
        };

    if (form.type === 'stdio' && !config.command) { setFormError('Command is required for a stdio server'); return; }
    if (form.type !== 'stdio' && !config.url) { setFormError('URL is required for a remote server'); return; }

    setIsSaving(true);
    setFormError('');
    try {
      const result = await window.api.saveProfileMcpServer(profile.id, name, config, editingName || undefined);
      if (result.success) {
        setIsFormOpen(false);
        await load();
      } else {
        setFormError(result.message || 'Failed to save server');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove MCP server "${name}" from this profile?`)) return;
    setDeletingName(name);
    try {
      await window.api.deleteProfileMcpServer(profile.id, name);
      await load();
    } finally {
      setDeletingName(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--color-text-dim)]">
          Available to Claude Code sessions started with this profile. Restart an active session for changes to take effect.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} title="Refresh" className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openAddForm}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all"
          >
            <Plus size={12} /> Add Server
          </button>
        </div>
      </div>

      {isFormOpen && (
        <div className="flex flex-col gap-3 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg p-3">
          <div className="flex items-center gap-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Server name (e.g. filesystem)"
              className="flex-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[12px] font-mono text-[var(--color-text-primary)]"
            />
            <div className="flex items-center gap-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded p-0.5">
              {(['stdio', 'http', 'sse'] as McpServerType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                    form.type === t ? 'bg-[var(--color-accent)] text-black' : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {form.type === 'stdio' ? (
            <>
              <input
                value={form.command}
                onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                placeholder="Command (e.g. npx)"
                className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[12px] font-mono text-[var(--color-text-primary)]"
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Args (one per line)</label>
                  <textarea
                    value={form.argsText}
                    onChange={e => setForm(f => ({ ...f, argsText: e.target.value }))}
                    rows={3}
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
                    className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[11px] font-mono text-[var(--color-text-primary)] resize-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Env (KEY=value per line)</label>
                  <textarea
                    value={form.envText}
                    onChange={e => setForm(f => ({ ...f, envText: e.target.value }))}
                    rows={3}
                    placeholder={'API_KEY=xxxx'}
                    className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[11px] font-mono text-[var(--color-text-primary)] resize-none"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <input
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://mcp.example.com/mcp"
                className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[12px] font-mono text-[var(--color-text-primary)]"
              />
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Headers (Name: value per line)</label>
                <textarea
                  value={form.headersText}
                  onChange={e => setForm(f => ({ ...f, headersText: e.target.value }))}
                  rows={2}
                  placeholder={'Authorization: Bearer xxxx'}
                  className="bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[11px] font-mono text-[var(--color-text-primary)] resize-none"
                />
              </div>
            </>
          )}

          {formError && <p className="text-[11px] text-[var(--color-status-red)]">{formError}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={() => setIsFormOpen(false)} className="px-3 py-1.5 rounded text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {editingName ? 'Save Changes' : 'Add Server'}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg overflow-hidden">
        {error && <div className="px-3 py-2 text-[12px] text-[var(--color-status-red)]">{error}</div>}
        {!error && servers.length === 0 && !loading && (
          <div className="px-3 py-3 text-[12px] text-[var(--color-text-dim)]">No MCP servers configured for this profile yet.</div>
        )}
        {servers.map(server => (
          <div key={server.name} className="flex items-center justify-between gap-3 px-3 py-2.5 group">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <Server size={14} className="text-[var(--color-accent)] shrink-0" />
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-mono text-[var(--color-text-primary)] truncate">{server.name}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-dim)] shrink-0">
                    {server.type}
                  </span>
                </div>
                <span className="text-[10.5px] font-mono text-[var(--color-text-dim)] truncate">
                  {server.type === 'stdio' ? `${server.command || ''} ${(server.args || []).join(' ')}`.trim() : server.url}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openEditForm(server)} title="Edit" className="p-1.5 rounded text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors">
                <Pencil size={13} />
              </button>
              <button
                onClick={() => handleDelete(server.name)}
                disabled={deletingName === server.name}
                title="Remove"
                className="p-1.5 rounded text-[var(--color-text-dim)] hover:text-red-500 hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function describeSource(source: any): string {
  if (!source) return '';
  if (typeof source === 'string') return source;
  if (source.repo) return source.repo + (source.ref ? `@${source.ref}` : '');
  if (source.url) return source.url;
  if (source.path) return source.path;
  return JSON.stringify(source);
}

function PluginsTab({ profile }: { profile: Profile }) {
  const [marketplaces, setMarketplaces] = useState<any[]>([]);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [available, setAvailable] = useState<Array<{ spec: string; name: string; marketplace: string; description?: string; version?: string; installed: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [mktError, setMktError] = useState('');
  const [pluginError, setPluginError] = useState('');
  const [newMarketplace, setNewMarketplace] = useState('');
  const [newPluginSpec, setNewPluginSpec] = useState('');
  const [busySpec, setBusySpec] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [mktRes, pluginRes] = await Promise.all([
      window.api.getProfilePluginMarketplaces(profile.id),
      window.api.getProfilePlugins(profile.id),
    ]);
    const installed = pluginRes.plugins || [];
    setMarketplaces(mktRes.marketplaces || []);
    setMktError(mktRes.error || '');
    setPlugins(installed);
    setPluginError(pluginRes.error || '');

    const installedIds = installed.map((p: any) => p.id || p.name).filter(Boolean);
    const availRes = await window.api.getProfileAvailablePlugins(profile.id, installedIds);
    setAvailable((availRes.plugins || []).filter(p => !p.installed));
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile.id]);

  const handleAddMarketplace = async () => {
    const source = newMarketplace.trim();
    if (!source || busySpec) return;
    setBusySpec(`marketplace:${source}`);
    setActionMessage(null);
    const result = await window.api.addProfilePluginMarketplace(profile.id, source);
    setBusySpec(null);
    setActionMessage({ type: result.success ? 'success' : 'error', text: result.message || (result.success ? 'Marketplace added — install a plugin from it below' : 'Failed to add marketplace') });
    if (result.success) { setNewMarketplace(''); await load(); }
  };

  const handleRemoveMarketplace = async (name: string) => {
    if (!confirm(`Remove marketplace "${name}"? This uninstalls any plugins installed from it.`)) return;
    setBusySpec(`marketplace:${name}`);
    setActionMessage(null);
    const result = await window.api.removeProfilePluginMarketplace(profile.id, name);
    setBusySpec(null);
    setActionMessage({ type: result.success ? 'success' : 'error', text: result.message || (result.success ? 'Marketplace removed' : 'Failed to remove marketplace') });
    if (result.success) await load();
  };

  const installSpec = async (spec: string) => {
    if (!spec || busySpec) return;
    setBusySpec(`plugin:${spec}`);
    setActionMessage(null);
    const result = await window.api.installProfilePlugin(profile.id, spec);
    setBusySpec(null);
    setActionMessage({
      type: result.success ? 'success' : 'error',
      text: result.message || (result.success
        ? `Installed "${spec}" — restart the session tab to load skills`
        : 'Failed to install plugin'),
    });
    if (result.success) { setNewPluginSpec(''); await load(); }
  };

  const handleInstallPlugin = async () => {
    await installSpec(newPluginSpec.trim());
  };

  const handleUninstallPlugin = async (spec: string) => {
    if (!confirm(`Uninstall "${spec}"?`)) return;
    setBusySpec(`plugin:${spec}`);
    setActionMessage(null);
    const result = await window.api.uninstallProfilePlugin(profile.id, spec);
    setBusySpec(null);
    setActionMessage({ type: result.success ? 'success' : 'error', text: result.message || (result.success ? 'Plugin uninstalled' : 'Failed to uninstall plugin') });
    if (result.success) await load();
  };

  const handleToggleEnabled = async (spec: string, enabled: boolean) => {
    setPlugins(prev => prev.map(p => ((p.id || p.name) === spec ? { ...p, enabled } : p)));
    await window.api.setProfilePluginEnabled(profile.id, spec, enabled);
    setActionMessage({
      type: 'success',
      text: enabled
        ? `Enabled "${spec}" — restart the session tab to apply`
        : `Disabled "${spec}" — restart the session tab to apply`,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[11px] text-[var(--color-text-dim)] leading-relaxed -mb-1">
        Marketplaces only catalog plugins. Skills load after you <span className="text-[var(--color-text-secondary)]">Install</span> a plugin and restart the session tab.
      </p>

      <div className="flex items-center justify-end -mb-2">
        <button onClick={load} title="Refresh" className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {actionMessage && (
        <p className={`text-[11px] -mb-2 ${actionMessage.type === 'success' ? 'text-[var(--color-status-green)]' : 'text-[var(--color-status-red)]'}`}>
          {actionMessage.text}
        </p>
      )}

      {/* Marketplaces */}
      <div className="flex flex-col gap-2">
        <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Marketplaces</label>
        <div className="flex items-center gap-1.5">
          <input
            value={newMarketplace}
            onChange={e => setNewMarketplace(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddMarketplace(); }}
            placeholder="owner/repo, git URL, or local path"
            className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[12px] font-mono text-[var(--color-text-primary)]"
          />
          <button
            onClick={handleAddMarketplace}
            disabled={!newMarketplace.trim() || !!busySpec}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {busySpec === `marketplace:${newMarketplace.trim()}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add
          </button>
        </div>

        <div className="flex flex-col divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg overflow-hidden">
          {mktError && <div className="px-3 py-2 text-[12px] text-[var(--color-status-red)]">{mktError}</div>}
          {!mktError && marketplaces.length === 0 && !loading && (
            <div className="px-3 py-2.5 text-[12px] text-[var(--color-text-dim)]">No marketplaces added for this profile.</div>
          )}
          {marketplaces.map((m, i) => {
            const name = m.name || m.id || `marketplace-${i}`;
            return (
              <div key={name} className="flex items-center justify-between gap-3 px-3 py-2 group">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Store size={13} className="text-[var(--color-accent)] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-mono text-[var(--color-text-primary)] truncate">{name}</span>
                    <span className="text-[10.5px] font-mono text-[var(--color-text-dim)] truncate">{describeSource(m.source)}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveMarketplace(name)}
                  disabled={busySpec === `marketplace:${name}`}
                  title="Remove marketplace"
                  className="p-1.5 rounded text-[var(--color-text-dim)] hover:text-red-500 hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                >
                  {busySpec === `marketplace:${name}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Available from marketplaces (not yet installed) */}
      {available.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Available to Install</label>
          <div className="flex flex-col divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg max-h-[180px] overflow-y-auto">
            {available.map(p => (
              <div key={p.spec} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Package size={13} className="text-[var(--color-text-dim)] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-mono text-[var(--color-text-primary)] truncate">{p.spec}</span>
                    {p.description && (
                      <span className="text-[10.5px] text-[var(--color-text-dim)] truncate">{p.description}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => installSpec(p.spec)}
                  disabled={!!busySpec}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent)] hover:text-black transition-colors disabled:opacity-50"
                >
                  {busySpec === `plugin:${p.spec}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Install
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Installed plugins */}
      <div className="flex flex-col gap-2">
        <label className="font-ui text-[11px] text-[var(--color-text-dim)] uppercase tracking-wider font-semibold">Installed Plugins</label>
        <div className="flex items-center gap-1.5">
          <input
            value={newPluginSpec}
            onChange={e => setNewPluginSpec(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleInstallPlugin(); }}
            placeholder="plugin-name@marketplace"
            className="flex-1 bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] focus:border-[var(--color-accent)] outline-none px-2.5 py-1.5 rounded text-[12px] font-mono text-[var(--color-text-primary)]"
          />
          <button
            onClick={handleInstallPlugin}
            disabled={!newPluginSpec.trim() || !!busySpec}
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {busySpec === `plugin:${newPluginSpec.trim()}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Install
          </button>
        </div>

        <div className="flex flex-col divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded-lg overflow-hidden">
          {pluginError && <div className="px-3 py-2 text-[12px] text-[var(--color-status-red)]">{pluginError}</div>}
          {!pluginError && plugins.length === 0 && !loading && (
            <div className="px-3 py-2.5 text-[12px] text-[var(--color-text-dim)]">
              No plugins installed for this profile yet. Adding a marketplace is not enough — install a plugin above.
            </div>
          )}
          {plugins.map((p, i) => {
            const spec = p.id || p.name || `plugin-${i}`;
            const enabled = p.enabled !== false;
            return (
              <div key={spec} className="flex items-center justify-between gap-3 px-3 py-2 group">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Package size={13} className="text-[var(--color-accent)] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-mono text-[var(--color-text-primary)] truncate">{spec}</span>
                    {p.version && <span className="text-[10.5px] font-mono text-[var(--color-text-dim)] truncate">v{p.version}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-text-dim)] cursor-pointer select-none" title="Enabled">
                    <input type="checkbox" checked={enabled} onChange={e => handleToggleEnabled(spec, e.target.checked)} className="accent-[var(--color-accent)]" />
                    Enabled
                  </label>
                  <button
                    onClick={() => handleUninstallPlugin(spec)}
                    disabled={busySpec === `plugin:${spec}`}
                    title="Uninstall"
                    className="p-1.5 rounded text-[var(--color-text-dim)] hover:text-red-500 hover:bg-[var(--color-bg-hover)] transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
                  >
                    {busySpec === `plugin:${spec}` ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProfileConfigModal({ profile, onClose }: ProfileConfigModalProps) {
  const [tab, setTab] = useState<Tab>('mcp');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-[110] flex items-center justify-center">
      <div className="w-[560px] max-h-[82vh] flex flex-col bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex flex-col">
            <h2 className="text-[18px] text-[var(--color-text-primary)] font-semibold">MCP & Plugins</h2>
            <span className="text-[11px] text-[var(--color-text-dim)]">Profile: {profile.name}</span>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1 mb-4 border-b border-[var(--color-border-subtle)]">
          <button
            onClick={() => setTab('mcp')}
            className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
              tab === 'mcp' ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Server size={13} /> MCP Servers
          </button>
          <button
            onClick={() => setTab('plugins')}
            className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
              tab === 'plugins' ? 'border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <Blocks size={13} /> Plugins
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar pr-1">
          {tab === 'mcp' ? <McpServersTab profile={profile} /> : <PluginsTab profile={profile} />}
        </div>

        <div className="flex justify-end mt-5 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded text-[13px] font-medium bg-[var(--color-accent)] text-black hover:brightness-110 transition-all">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
