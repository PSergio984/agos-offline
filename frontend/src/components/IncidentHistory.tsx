import React, { useEffect, useState } from 'react';
import { Incident } from '../types';
import { fetchIncidents, resolveIncident } from '../services/api';
import { ReadingDetailModal } from './ReadingDetailModal';
import {
  History,
  RefreshCw,
  Search,
  Clock,
  Radio,
  AlertTriangle,
  Flame,
  X,
  Camera,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';

interface IncidentHistoryProps {
  onSelectIncidentForRadio?: (incident: Incident) => void;
  isOpenAsDrawer?: boolean;
  onCloseDrawer?: () => void;
}

export const IncidentHistory: React.FC<IncidentHistoryProps> = ({
  onSelectIncidentForRadio,
  isOpenAsDrawer = false,
  onCloseDrawer,
}) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [inspectingIncident, setInspectingIncident] = useState<Incident | null>(null);
  const [isResolving, setIsResolving] = useState<boolean>(false);

  const loadIncidents = async () => {
    setIsLoading(true);
    try {
      const data = await fetchIncidents();
      setIncidents(data);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResolve = async (id: string) => {
    setIsResolving(true);
    try {
      await resolveIncident(id);
      await loadIncidents();
      if (inspectingIncident && inspectingIncident.id === id) {
        setInspectingIncident((prev) => (prev ? { ...prev, action_taken: 'RESOLVED' } : null));
      }
    } finally {
      setIsResolving(false);
    }
  };

  useEffect(() => {
    loadIncidents();
  }, []);

  const filteredIncidents = incidents.filter((item) => {
    const matchesSearch =
      item.camera_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'CRITICAL' && (item.status === 'CRITICAL' || item.status === 'CRITICAL BLOCKED')) ||
      (statusFilter === 'WARNING' && item.status === 'WARNING') ||
      (statusFilter === 'RESOLVED' && item.action_taken === 'RESOLVED');

    return matchesSearch && matchesStatus;
  });

  const content = (
    <div className="flex flex-col h-full bg-transparent text-slate-800 dark:text-slate-100 font-sans transition-colors">
      {/* Header */}
      <div className="p-4 sm:px-6 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 dark:bg-primary/30 text-primary dark:text-teal-400 rounded-xl border border-primary/20 dark:border-teal-500/20 shadow-sm">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white tracking-tight">
              Drainage Incident Log
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              On-premises obstruction telemetry archived in SQLite (`storage/incidents/`)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadIncidents}
            disabled={isLoading}
            className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors border border-slate-200 dark:border-slate-800 cursor-pointer shadow-sm"
            title="Refresh Incidents"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-teal-500 dark:text-teal-400' : ''}`} />
          </button>
          {isOpenAsDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer border border-slate-200 dark:border-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="p-4 sm:px-6 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800/80 flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search camera device, location, or incident ID..."
            className="w-full bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          {['ALL', 'CRITICAL', 'WARNING', 'RESOLVED'].map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap cursor-pointer border ${
                statusFilter === filter
                  ? 'bg-primary text-white border-primary shadow-sm font-semibold'
                  : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200 border-slate-200 dark:border-slate-800'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Incident List: Spacious Responsive Card Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {filteredIncidents.length === 0 ? (
          <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-sm flex flex-col items-center justify-center gap-2">
            <SlidersHorizontal className="w-8 h-8 opacity-40 mb-1" />
            <p className="font-medium">No recorded incidents matching the filter criteria.</p>
            <p className="text-xs text-slate-400">All drainage sensors and grates are operating within normal thresholds.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {filteredIncidents.map((incident) => {
              const isCrit = incident.status === 'CRITICAL' || incident.status === 'CRITICAL BLOCKED';
              const isWarn = incident.status === 'WARNING';

              return (
                <div
                  key={incident.id}
                  className="bg-white/90 dark:bg-slate-900/60 hover:bg-slate-50/90 dark:hover:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4 group"
                >
                  {/* Card Header: Device, Badges, and ID */}
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full uppercase border tracking-wider shadow-xs ${
                            isCrit
                              ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800/80'
                              : isWarn
                              ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800/80'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800/80'
                          }`}
                        >
                          {isCrit ? <Flame className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          <span>{incident.status}</span>
                        </span>

                        {incident.source_type === 'demo' && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/60 font-mono">
                            Demo Loop
                          </span>
                        )}
                      </div>

                      <span className="font-mono text-xs font-semibold text-slate-400 dark:text-slate-500">
                        #{incident.id}
                      </span>
                    </div>

                    <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white leading-snug">
                      {incident.camera_name}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                      {incident.location}
                    </p>
                  </div>

                  {/* Card Center: Visual Thumbnail & Occlusion Progress */}
                  <div className="flex items-center gap-4 bg-slate-50/80 dark:bg-slate-950/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/60">
                    {/* Thumbnail preview */}
                    <div className="w-20 h-16 sm:w-24 sm:h-20 rounded-lg overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-center relative">
                      {incident.snapshot_url ? (
                        <img
                          src={incident.snapshot_url}
                          alt={incident.camera_name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Camera className="w-6 h-6 text-slate-600 dark:text-slate-500" />
                      )}
                      <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1 rounded bg-black/70 text-teal-300">
                        HD
                      </span>
                    </div>

                    {/* Progress & Telemetry */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between h-full gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Surface Occlusion
                        </span>
                        <span
                          className={`text-sm font-extrabold font-mono ${
                            isCrit
                              ? 'text-rose-600 dark:text-rose-400'
                              : isWarn
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {incident.occlusion_ratio.toFixed(1)}%
                        </span>
                      </div>

                      {/* Mini Progress Bar */}
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isCrit
                              ? 'bg-rose-500'
                              : isWarn
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, incident.occlusion_ratio))}%` }}
                        />
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span className="truncate">{incident.timestamp}</span>
                      </div>
                    </div>
                  </div>

                  {/* Debris Pills */}
                  {incident.debris_types && incident.debris_types.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {incident.debris_types.map((deb, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
                        >
                          {deb}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Card Bottom: Action Pills */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <div>
                      {incident.action_taken ? (
                        <span
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                            incident.action_taken === 'RESOLVED'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                              : incident.action_taken === 'DISPATCHED'
                              ? 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/20'
                              : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                          }`}
                        >
                          {incident.action_taken}
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          Action Pending
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setInspectingIncident(incident)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                        title="Open Detection Inspection Modal"
                      >
                        <Camera className="w-3.5 h-3.5 text-primary dark:text-teal-400" />
                        <span>Inspect</span>
                      </button>

                      {onSelectIncidentForRadio && (
                        <button
                          type="button"
                          onClick={() => onSelectIncidentForRadio(incident)}
                          className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-primary/20 dark:hover:bg-primary/30 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          title="Launch Voice Radio Dispatch"
                        >
                          <Radio className="w-3.5 h-3.5 text-teal-600 dark:text-teal-300" />
                          <span>Radio</span>
                        </button>
                      )}

                      {incident.action_taken !== 'RESOLVED' && (
                        <button
                          type="button"
                          disabled={isResolving}
                          onClick={() => handleResolve(incident.id)}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                          title="Mark Incident Resolved"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Resolve</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Summary */}
      <div className="p-3.5 sm:px-6 bg-slate-50/70 dark:bg-slate-950/60 border-t border-slate-200/80 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between font-medium">
        <span>Recorded Incidents: {filteredIncidents.length}</span>
        <span className="text-teal-700 dark:text-teal-400 font-mono text-[11px] font-semibold">
          storage/incidents/agos.db
        </span>
      </div>

      {/* High-Resolution Forensic Detection Modal */}
      {inspectingIncident && (
        <ReadingDetailModal
          incident={inspectingIncident}
          onClose={() => setInspectingIncident(null)}
          onResolve={handleResolve}
          onVoiceRadioDispatch={onSelectIncidentForRadio}
          isResolving={isResolving}
        />
      )}
    </div>
  );

  if (isOpenAsDrawer) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="w-full max-w-2xl h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-[#0B1526]">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl shadow-xl overflow-hidden">
      {content}
    </div>
  );
};

export default IncidentHistory;
