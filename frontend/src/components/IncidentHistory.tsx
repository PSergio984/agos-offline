import React, { useEffect, useState } from 'react';
import { Incident } from '../types';
import { fetchIncidents, resolveIncident } from '../services/api';
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
    <div className="flex flex-col h-full bg-white dark:bg-[#0B1526]/90 text-slate-800 dark:text-slate-100 font-sans transition-colors">
      {/* Header */}
      <div className="p-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 dark:bg-primary/30 text-primary dark:text-teal-400 rounded-xl border border-primary/20 dark:border-teal-500/20 shadow-sm">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg text-primary dark:text-white tracking-tight">
              Drainage Incident Log
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              On-premises history stored in SQLite (`storage/incidents/`)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadIncidents}
            disabled={isLoading}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors border border-slate-200 dark:border-slate-800 cursor-pointer shadow-sm"
            title="Refresh Incidents"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-teal-500 dark:text-teal-400' : ''}`} />
          </button>
          {isOpenAsDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer border border-slate-200 dark:border-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="p-4 sm:px-6 bg-slate-50/80 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800/80 flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search camera, location, or incident ID..."
            className="w-full bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500 dark:focus:border-teal-500 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-sm"
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

      {/* Incidents Table / List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 p-3 sm:p-4 space-y-2">
        {filteredIncidents.length === 0 ? (
          <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs">
            No incidents recorded matching the filter criteria.
          </div>
        ) : (
          filteredIncidents.map((incident) => {
            const isCrit = incident.status === 'CRITICAL' || incident.status === 'CRITICAL BLOCKED';
            const isWarn = incident.status === 'WARNING';

            return (
              <div
                key={incident.id}
                className="p-3.5 rounded-xl bg-white hover:bg-slate-50/80 dark:bg-slate-900/50 dark:hover:bg-slate-900/90 transition-all border border-slate-200 dark:border-slate-800/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                {/* Left Information */}
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`p-2.5 rounded-xl mt-0.5 flex-shrink-0 border shadow-sm ${
                      isCrit
                        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/90 dark:text-rose-400 dark:border-rose-800'
                        : isWarn
                        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/90 dark:text-amber-400 dark:border-amber-800'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/90 dark:text-emerald-400 dark:border-emerald-800'
                    }`}
                  >
                    {isCrit ? <Flame className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-sans text-sm font-bold text-slate-900 dark:text-white">
                        {incident.camera_name}
                      </span>
                      <span
                        className={`text-[10px] font-sans font-bold px-2 py-0.5 rounded uppercase border tracking-wide ${
                          isCrit
                            ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                            : isWarn
                            ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                        }`}
                      >
                        {incident.status}
                      </span>
                      {incident.source_type === 'demo' && (
                        <span className="text-[10px] font-sans font-bold px-2 py-0.5 rounded uppercase border tracking-wide bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800">
                          Demo
                        </span>
                      )}
                      <span className="text-rose-600 dark:text-rose-400 font-mono text-xs font-bold">
                        {incident.occlusion_ratio.toFixed(1)}% Occlusion
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-300 font-medium truncate mt-1">
                      {incident.location}
                    </div>

                    <div className="flex items-center gap-3.5 mt-1.5 text-[11px] font-mono text-slate-600 dark:text-slate-300 flex-wrap">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
                        {incident.timestamp}
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        ID: {incident.id}
                      </span>
                      {incident.debris_types && incident.debris_types.length > 0 && (
                        <span className="text-slate-700 dark:text-slate-200 font-medium">
                          Debris: {incident.debris_types.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Status & Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                  {incident.action_taken && (
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full border shadow-sm ${
                        incident.action_taken === 'DISPATCHED'
                          ? 'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/20'
                          : incident.action_taken === 'RESOLVED'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                          : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800'
                      }`}
                    >
                      {incident.action_taken}
                    </span>
                  )}

                  {/* Inspect Snapshot Button */}
                  <button
                    type="button"
                    onClick={() => setInspectingIncident(incident)}
                    className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                    title="Inspect Forensic Snapshot"
                  >
                    <Camera className="w-3.5 h-3.5 text-primary dark:text-teal-400" />
                    <span className="hidden sm:inline">Inspect</span>
                  </button>

                  {onSelectIncidentForRadio && (
                    <button
                      type="button"
                      onClick={() => onSelectIncidentForRadio(incident)}
                      className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-primary/20 dark:hover:bg-primary/40 text-teal-800 dark:text-teal-300 border border-teal-300 dark:border-teal-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                      title="Dispatch via Radio"
                    >
                      <Radio className="w-3.5 h-3.5 text-teal-600 dark:text-teal-300" />
                      <span className="hidden sm:inline">Radio</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Summary */}
      <div className="p-3.5 sm:px-6 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between font-medium">
        <span>Recorded Incidents: {filteredIncidents.length}</span>
        <span className="text-teal-700 dark:text-teal-400 font-mono text-[11px] font-semibold">
          storage/incidents/agos.db
        </span>
      </div>

      {/* Forensic Snapshot & Inspection Modal */}
      {inspectingIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 dark:bg-primary/30 text-primary dark:text-teal-400 rounded-xl">
                  <Camera className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-primary dark:text-white">Incident Forensic Snapshot</h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingIncident(null)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Snapshot Image Preview */}
            <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 aspect-video flex items-center justify-center">
              {inspectingIncident.snapshot_url ? (
                <img
                  src={inspectingIncident.snapshot_url}
                  alt="Obstruction Snapshot"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="text-center p-6 text-slate-400 text-xs font-mono">
                  <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2 opacity-80" />
                  <span>Captured in SQLite (`storage/incidents/`)</span>
                </div>
              )}
            </div>

            {/* Forensic Details */}
            <div className="space-y-2 text-xs font-mono bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">INCIDENT ID:</span>
                <span className="text-slate-900 dark:text-white font-bold">{inspectingIncident.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">CAMERA / LOCATION:</span>
                <span className="text-primary dark:text-teal-300 font-bold">{inspectingIncident.camera_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">OCCLUSION RATIO:</span>
                <span className="text-rose-600 dark:text-rose-400 font-bold">
                  {inspectingIncident.occlusion_ratio.toFixed(1)}% ({inspectingIncident.status})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">TIMESTAMP:</span>
                <span className="text-slate-800 dark:text-slate-200">{inspectingIncident.timestamp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">ACTION STATUS:</span>
                <span
                  className={`font-bold ${
                    inspectingIncident.action_taken === 'RESOLVED'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {inspectingIncident.action_taken || 'PENDING'}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              {inspectingIncident.action_taken !== 'RESOLVED' && (
                <button
                  type="button"
                  disabled={isResolving}
                  onClick={() => handleResolve(inspectingIncident.id)}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isResolving ? 'Resolving...' : 'Mark as Resolved'}</span>
                </button>
              )}
              {onSelectIncidentForRadio && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectIncidentForRadio(inspectingIncident);
                    setInspectingIncident(null);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                >
                  <Radio className="w-4 h-4 text-teal-300" />
                  <span>Radio Dispatch</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setInspectingIncident(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isOpenAsDrawer) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="w-full max-w-xl h-full shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 overflow-hidden shadow-sm bg-white dark:bg-[#0B1526]/90">
      {content}
    </div>
  );
};
