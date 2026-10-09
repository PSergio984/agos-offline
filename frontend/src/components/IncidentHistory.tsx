import React, { useEffect, useState } from 'react';
import { Incident } from '../types';
import { fetchIncidents, resolveIncident } from '../services/api';
import { ReadingDetailModal } from './ReadingDetailModal';
import {
  RefreshCw,
  Search,
  Clock,
  Radio,
  TriangleAlert,
  CircleAlert,
  CircleCheck,
  X,
  Camera,
  CheckCircle2,
} from 'lucide-react';

interface IncidentHistoryProps {
  onSelectIncidentForRadio?: (incident: Incident) => void;
  isOpenAsDrawer?: boolean;
  onCloseDrawer?: () => void;
}

const STATUS_BADGES = {
  clear:
    'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800/50',
  warning:
    'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-800/50',
  critical:
    'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800/50',
};

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
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());

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
      (statusFilter === 'CLEAR' && item.status === 'CLEAR') ||
      (statusFilter === 'RESOLVED' && item.action_taken === 'RESOLVED');

    return matchesSearch && matchesStatus;
  });

  const content = (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="pl-2 border-l-4 font-semibold text-gray-600 dark:text-slate-300 border-primary dark:border-blue-500 uppercase tracking-wide">
            Detection Logs
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium pl-2 mt-0.5">
            Past trash and blockage records saved on this computer
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadIncidents}
            disabled={isLoading}
            className="p-2 rounded-xl bg-white/40 dark:bg-white/5 border border-gray-200/50 dark:border-white/10 text-gray-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title="Refresh Incidents"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-primary dark:text-blue-400' : ''}`} />
          </button>
          {isOpenAsDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              className="p-2 rounded-xl bg-white/40 dark:bg-white/5 border border-gray-200/50 dark:border-white/10 text-gray-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Search & status chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl p-2 rounded-2xl w-full sm:flex-1 sm:max-w-md border border-white/50 dark:border-white/10 transition-all duration-300">
          <label className="relative w-full block" title="Search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search camera, location, or record ID..."
              className="w-full pl-11 pr-4 peer bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 dark:focus:ring-blue-500/20 text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 transition-all py-2.5"
            />
            <Search
              className="absolute text-gray-500 dark:text-slate-500 peer-focus:text-gray-900 dark:peer-focus:text-slate-200 left-3.5 top-0 h-full transition-colors"
              size={20}
            />
          </label>
        </div>

        <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
          {[
            { label: 'All', value: 'ALL' },
            { label: 'Clear', value: 'CLEAR' },
            { label: 'Possible', value: 'WARNING' },
            { label: 'Potential', value: 'CRITICAL' },
            { label: 'Resolved', value: 'RESOLVED' },
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 uppercase tracking-widest cursor-pointer ${
                statusFilter === f.value
                  ? 'bg-primary dark:bg-blue-600 text-white shadow-lg scale-105'
                  : 'bg-white/40 dark:bg-white/5 text-gray-600 dark:text-slate-400 border border-gray-200/50 dark:border-white/5 hover:bg-white/60 dark:hover:bg-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Incident list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton w-full h-20 rounded-lg" />
            ))}
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-slate-500 text-center py-8">
            <p>No recorded incidents matching the filter criteria.</p>
            <p className="text-xs mt-1 text-gray-400 dark:text-slate-600">
              All drainage channels are operating within normal water flow.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredIncidents.map((incident) => {
              const isCrit = incident.status === 'CRITICAL' || incident.status === 'CRITICAL BLOCKED';
              const isWarn = incident.status === 'WARNING';
              const statusKey = isCrit ? 'critical' : isWarn ? 'warning' : 'clear';

              const statusBadgeLabel = isCrit
                ? 'Potential Surface Obstruction'
                : isWarn
                ? 'Possible Surface Obstruction'
                : 'Clear';

              const StatusIcon = isCrit ? CircleAlert : isWarn ? TriangleAlert : CircleCheck;
              const accentClass = isCrit
                ? 'text-red-600 dark:text-red-400'
                : isWarn
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400';

              return (
                <div
                  key={incident.id}
                  className="w-full p-4 rounded-xl border transition-all duration-300 border-gray-200/50 dark:border-white/5 bg-white/40 dark:bg-white/[0.02] hover:border-gray-300 dark:hover:border-white/20 hover:bg-white/60 dark:hover:bg-white/[0.05] hover:shadow-md"
                >
                  {/* Badges + occlusion */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span
                        className={`inline-flex items-center gap-1 text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-full ${STATUS_BADGES[statusKey]}`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {statusBadgeLabel}
                      </span>

                      {incident.source_type === 'demo' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/60 font-mono">
                          Demo
                        </span>
                      )}
                      {incident.source_type && incident.source_type !== 'demo' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-mono">
                          {incident.source_type}
                        </span>
                      )}

                      {incident.cloud_synced === true && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60 font-mono">
                          Synced
                        </span>
                      )}
                      {incident.cloud_synced === false && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60 font-mono">
                          Pending Sync
                        </span>
                      )}

                      {incident.radio_ticket && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-mono">
                          Ticket {incident.radio_ticket}
                        </span>
                      )}
                    </div>

                    <span className={`flex items-center gap-1 text-sm font-extrabold font-mono shrink-0 ${accentClass}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {incident.occlusion_ratio.toFixed(1)}%
                    </span>
                  </div>

                  {/* Thumbnail + camera/location/timestamp */}
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-12 sm:w-20 sm:h-14 rounded-lg overflow-hidden bg-slate-900 border border-gray-200 dark:border-slate-800 shrink-0 flex items-center justify-center">
                      {incident.snapshot_url && !failedThumbs.has(incident.snapshot_url) ? (
                        <img
                          src={incident.snapshot_url}
                          alt={incident.camera_name}
                          className="w-full h-full object-cover"
                          onError={() => {
                            const failedUrl = incident.snapshot_url as string;
                            setFailedThumbs((prev) => new Set(prev).add(failedUrl));
                          }}
                        />
                      ) : (
                        <Camera className="w-5 h-5 text-slate-600 dark:text-slate-500" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                          {incident.camera_name}
                        </h4>
                        <span className="font-mono text-[10px] font-semibold text-slate-400 dark:text-slate-500 shrink-0">
                          #{incident.id}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                        {incident.location}
                      </p>
                      <div className="flex items-center gap-1.5 text-[0.68rem] text-gray-400 dark:text-slate-500 font-medium mt-0.5">
                        <Clock className="w-3 h-3 shrink-0" />
                        <span className="truncate font-mono">{incident.timestamp}</span>
                      </div>
                    </div>
                  </div>

                  {/* Debris pills */}
                  {incident.debris_types && incident.debris_types.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
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

                  {/* Action row */}
                  <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
                    <div>
                      {incident.action_taken ? (
                        <span
                          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                            incident.action_taken === 'RESOLVED'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                              : 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20'
                          }`}
                        >
                          {incident.action_taken}
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          Needs Checking
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setInspectingIncident(incident)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                        title="Open Details"
                      >
                        <Camera className="w-3.5 h-3.5 text-primary dark:text-blue-400" />
                        <span>Inspect</span>
                      </button>

                      {onSelectIncidentForRadio && (
                        <button
                          type="button"
                          onClick={() => onSelectIncidentForRadio(incident)}
                          className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          title="Alert Team"
                        >
                          <Radio className="w-3.5 h-3.5" />
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

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400 font-medium shrink-0">
        <span>Recorded Incidents: {filteredIncidents.length}</span>
        <span className="text-primary dark:text-blue-400 font-mono text-[11px] font-semibold">
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
        <div className="w-full max-w-2xl h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-900 p-4 sm:p-6">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 rounded-2xl shadow-xl p-4 sm:p-6 flex flex-col min-w-0">
      {content}
    </div>
  );
};

export default IncidentHistory;
