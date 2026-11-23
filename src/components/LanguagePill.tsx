import { Globe } from 'lucide-react';
import { AppSettings, LanguageMode } from '../types';

interface LanguagePillProps {
  settings: AppSettings;
  onChangeMode: (mode: LanguageMode) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
}

export function LanguagePill({ settings, onChangeMode, onOpenSettings, disabled }: LanguagePillProps) {
  const modeLabel =
    settings.languageMode === 'fixed'
      ? `Fixed: ${settings.primaryLanguage.toUpperCase()}`
      : settings.languageMode === 'bilingual'
        ? `Bilingual: ${settings.primaryLanguage.toUpperCase()} + ${settings.secondaryLanguage.toUpperCase()}`
        : 'Auto-Detect';

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
      <Globe className="h-3.5 w-3.5 text-primary" />
      <select
        disabled={disabled}
        value={settings.languageMode}
        onChange={(e) => onChangeMode(e.target.value as LanguageMode)}
        className="bg-transparent font-medium outline-none cursor-pointer disabled:cursor-not-allowed"
        title="Quick switch meeting language mode"
      >
        <option value="fixed">Primary Only ({settings.primaryLanguage.toUpperCase()})</option>
        <option value="bilingual">
          Bilingual ({settings.primaryLanguage.toUpperCase()} + {settings.secondaryLanguage.toUpperCase()})
        </option>
        <option value="auto">Full Auto-Detect</option>
      </select>
      <button
        type="button"
        onClick={onOpenSettings}
        className="ml-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
        title={`Current: ${modeLabel}. Click to configure languages`}
      >
        Configure
      </button>
    </div>
  );
}
