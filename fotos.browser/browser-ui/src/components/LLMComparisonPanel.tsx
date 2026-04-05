import { useEffect, useState, type ReactNode } from 'react';
import { Bot, RefreshCw } from 'lucide-react';
import type { PhotoEntry } from '@/types/fotos';
import type { FotosLLMComparisonResult, FotosLLMModelSummary } from '@/lib/FotosLLMPlan';
import { fotosLLMPlan } from '@/lib/FotosLLMPlan';
import { buildPhotoAnalyticsSnapshot } from '@/lib/fotosLLMComparison';

const SELECTED_MODEL_STORAGE_KEY = 'fotos.llm.selected-model-id';
const PREFERRED_MODEL_ID = 'gemma-4-e2b-it';

function formatModelFootprint(sizeBytes: number): string {
  if (sizeBytes <= 0) {
    return 'size unknown';
  }

  return `${(sizeBytes / (1024 ** 3)).toFixed(sizeBytes >= 1024 ** 3 ? 1 : 2)} GB`;
}

function getInitialSelectedModelId(): string {
  if (typeof window === 'undefined') {
    return PREFERRED_MODEL_ID;
  }

  return window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) || PREFERRED_MODEL_ID;
}

export function LLMComparisonPanel({
  photo,
  photoSourceLabel,
}: {
  photo: PhotoEntry | null;
  photoSourceLabel: string;
}) {
  const [models, setModels] = useState<FotosLLMModelSummary[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>(getInitialSelectedModelId);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [busyState, setBusyState] = useState<'refresh' | 'load' | 'unload' | 'compare' | null>(null);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [comparison, setComparison] = useState<FotosLLMComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, selectedModelId);
  }, [selectedModelId]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      setBusyState('refresh');
      setError(null);

      try {
        const status = await fotosLLMPlan.status();
        if (cancelled) {
          return;
        }

        setModels(status.models);
        setLoadedModelId(status.loadedModelId);
        setSelectedModelId((current) => {
          if (status.models.some((model) => model.modelId === current)) {
            return current;
          }

          if (status.models.some((model) => model.modelId === PREFERRED_MODEL_ID)) {
            return PREFERRED_MODEL_ID;
          }

          return status.models[0]?.modelId ?? current;
        });
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError instanceof Error ? refreshError.message : 'Failed to load local models');
        }
      } finally {
        if (!cancelled) {
          setBusyState(null);
        }
      }
    };

    void refresh();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModel = models.find((model) => model.modelId === selectedModelId) ?? null;
  const canCompare = Boolean(photo && selectedModelId);

  async function refreshStatus() {
    const status = await fotosLLMPlan.status();
    setModels(status.models);
    setLoadedModelId(status.loadedModelId);
  }

  async function handleRefreshStatus() {
    setBusyState('refresh');
    setError(null);

    try {
      await refreshStatus();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh model status');
    } finally {
      setBusyState(null);
    }
  }

  async function handleLoadModel() {
    if (!selectedModelId) {
      return;
    }

    setBusyState('load');
    setLoadProgress(0);
    setError(null);

    try {
      const status = await fotosLLMPlan.loadModel(
        { modelId: selectedModelId },
        (progress) => setLoadProgress(progress),
      );
      setModels(status.models);
      setLoadedModelId(status.loadedModelId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load model');
    } finally {
      setBusyState(null);
      setLoadProgress(null);
    }
  }

  async function handleUnloadModel() {
    setBusyState('unload');
    setError(null);

    try {
      const status = await fotosLLMPlan.unloadModel({ modelId: loadedModelId ?? undefined });
      setModels(status.models);
      setLoadedModelId(status.loadedModelId);
    } catch (unloadError) {
      setError(unloadError instanceof Error ? unloadError.message : 'Failed to unload model');
    } finally {
      setBusyState(null);
      setLoadProgress(null);
    }
  }

  async function handleCompare() {
    if (!photo || !selectedModelId) {
      return;
    }

    setBusyState('compare');
    setError(null);
    setLoadProgress(loadedModelId === selectedModelId ? null : 0);

    try {
      if (loadedModelId !== selectedModelId) {
        await fotosLLMPlan.loadModel(
          { modelId: selectedModelId },
          (progress) => setLoadProgress(progress),
        );
      }

      const nextComparison = await fotosLLMPlan.comparePhotoAnalytics({
        modelId: selectedModelId,
        snapshot: buildPhotoAnalyticsSnapshot(photo),
      });

      setComparison(nextComparison);
      await refreshStatus();
    } catch (compareError) {
      setError(compareError instanceof Error ? compareError.message : 'Comparison failed');
    } finally {
      setBusyState(null);
      setLoadProgress(null);
    }
  }

  return (
    <CollapsiblePanel>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] text-white/72">
            <Bot className="h-3.5 w-3.5 text-[#ff9db0]/70" />
            <span>LLM Comparison</span>
          </div>
          <p className="text-[10px] leading-relaxed text-white/30">
            Run a VGER-backed local model against the current photo analytics snapshot so we can audit ingestion quality.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefreshStatus()}
          disabled={busyState !== null}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/35 transition-colors hover:bg-white/10 hover:text-white/65 disabled:cursor-not-allowed disabled:opacity-50"
          title="Refresh model status"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busyState === 'refresh' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-[0.18em] text-white/24">Model</label>
        <select
          value={selectedModelId}
          onChange={(event) => setSelectedModelId(event.target.value)}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/68 focus:outline-none"
        >
          {models.map((model) => (
            <option key={model.modelId} value={model.modelId}>
              {model.name}
            </option>
          ))}
        </select>
        {selectedModel ? (
          <div className="space-y-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-2">
            <div className="text-[11px] text-white/62">
              {selectedModel.name} · {formatModelFootprint(selectedModel.sizeBytes)} · {selectedModel.contextLength.toLocaleString()} ctx
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedModel.supportsVision && (
                <CapabilityPill label="vision" accent />
              )}
              {selectedModel.supportsThinking && (
                <CapabilityPill label="thinking" />
              )}
              {selectedModel.supportsTools && (
                <CapabilityPill label="tools" />
              )}
              {selectedModel.loaded && (
                <CapabilityPill label="loaded" accent />
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-white/10 px-2.5 py-2 text-[10px] text-white/24">
            No local text-generation models discovered yet.
          </div>
        )}
      </div>

      {loadProgress !== null && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-[#e94560]/70 transition-[width] duration-200"
              style={{ width: `${Math.max(4, Math.min(100, loadProgress))}%` }}
            />
          </div>
          <div className="text-[10px] text-white/28">
            {busyState === 'compare' ? 'Preparing model for comparison' : 'Loading model'}{loadProgress > 0 ? ` · ${Math.round(loadProgress)}%` : ''}
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <button
          type="button"
          onClick={() => void handleLoadModel()}
          disabled={!selectedModelId || busyState !== null}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-white/48 transition-colors hover:bg-white/10 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Load selected model
        </button>
        <button
          type="button"
          onClick={() => void handleUnloadModel()}
          disabled={!loadedModelId || busyState !== null}
          className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-left text-[11px] text-white/48 transition-colors hover:bg-white/10 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Unload current model
        </button>
        <button
          type="button"
          onClick={() => void handleCompare()}
          disabled={!canCompare || busyState !== null}
          className="w-full rounded-md border border-[#e94560]/25 bg-[#e94560]/8 px-2.5 py-1.5 text-left text-[11px] text-[#ff9db0]/78 transition-colors hover:bg-[#e94560]/14 hover:text-[#ffc3cf] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Compare {photoSourceLabel}
        </button>
      </div>

      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-white/28">
        {photo
          ? `${photoSourceLabel}: ${photo.name}`
          : 'No photo is available for comparison yet.'}
      </div>

      {error && (
        <div className="rounded-md border border-[#e94560]/20 bg-[#e94560]/8 px-2.5 py-2 text-[10px] leading-relaxed text-[#ff9db0]/82">
          {error}
        </div>
      )}

      {comparison && (
        <div className="space-y-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2">
          <div className="space-y-1">
            <div className="text-[11px] text-white/72">
              {comparison.modelName} on {comparison.snapshot.name}
            </div>
            <div className="text-[10px] leading-relaxed text-white/28">
              {comparison.supportsVision && !comparison.imageInputReady
                ? 'Model is vision-capable; this pass audits the structured ingestion snapshot while we keep the multimodal seam in VGER.'
                : 'This pass audits the structured ingestion snapshot from fotos.'}
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-white/60">
            {comparison.response || 'The model returned an empty response.'}
          </div>
        </div>
      )}
    </CollapsiblePanel>
  );
}

function CollapsiblePanel({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-3">
      {children}
    </div>
  );
}

function CapabilityPill({
  label,
  accent = false,
}: {
  label: string;
  accent?: boolean;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${
        accent
          ? 'border-[#e94560]/35 bg-[#e94560]/10 text-[#ff9db0]/78'
          : 'border-white/10 bg-white/5 text-white/34'
      }`}
    >
      {label}
    </span>
  );
}
