import React, { useEffect, useState } from 'react';
import { Project } from '../types';

interface NewProjectModalProps {
  onClose: () => void;
  onCreated: (project: Project) => void;
}

export function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = name.trim();
    if (!cleaned || saving) return;
    setSaving(true);
    const result = await window.api.createProject(cleaned);
    setSaving(false);
    if (!result.success || !result.id) {
      alert(result.message || 'Failed to create project');
      return;
    }
    onCreated({ id: result.id, name: cleaned, created_at: new Date().toISOString() });
  };

  return (
    <div className="cd-scrim" onClick={onClose}>
      <form
        className="cd-dialog w-[420px]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="px-5 pt-[18px] pb-3.5 border-b-2 border-[var(--strong)] flex flex-col gap-1">
          <span className="text-[19px] font-extrabold tracking-tight">New project</span>
          <span className="font-mono text-[10.5px] text-[var(--dim)]">Sessions can be moved into this later.</span>
        </div>
        <div className="px-5 py-[18px] flex flex-col gap-2">
          <span className="cd-kicker">Project name</span>
          <input
            autoFocus
            className="cd-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="scalapay-subscription-club"
          />
        </div>
        <div className="border-t-2 border-[var(--strong)] px-5 py-3.5 flex justify-end gap-2.5">
          <button type="button" className="cd-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="cd-btn-primary" disabled={!name.trim() || saving}>
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}
