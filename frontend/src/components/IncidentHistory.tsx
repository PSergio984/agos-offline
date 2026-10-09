import React, { useEffect, useState } from 'react';
import { Incident } from '../types';
import { fetchIncidents } from '../services/api';
import {
  History,
  RefreshCw,
  Search,
  Clock,
  Radio,
  AlertTriangle,
  Flame,
  X,
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

  const loadIncidents = async () => {
    setIsLoading(true);
    try {
      const data = await fetchIncidents();
      setIncidents(data);
    } finally {
      setIsLoading(false);
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
    <div className="flex flex-col h-full bg-eoc-dark text-slate-100">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="font-bold text-sm text-white">Drainage Obstruction Incident Log</h3>
            <p className="text-[11px] text-slate-400">
              Offline records from local SQLite (`storage/incidents/`)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadIncidents}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700"
            title="Refresh Incidents"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
          {isOpenAsDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="p-3 bg-slate-900/60 border-b border-slate-800 flex flex-col sm:flex-row items-center gap-2">
        <div className="relative flex-1 w-full">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search camera, barangay, or ID..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
          {['ALL', 'CRITICAL', 'WARNING', 'RESOLVED'].map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStatusFilter(filter)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors whitespace-nowrap ${
                statusFilter === filter
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Incidents Table / List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80 p-2 space-y-1">
        {filteredIncidents.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            No incidents recorded matching the filter criteria.
          </div>
        ) : (
          filteredIncidents.map((incident) => {
            const isCrit = incident.status === 'CRITICAL' || incident.status === 'CRITICAL BLOCKED';
            const isWarn = incident.status === 'WARNING';

            return (
              <div
                key={incident.id}
                className="p-3 rounded-lg bg-slate-900/40 hover:bg-slate-900/90 transition-all border border-transparent hover:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                {/* Left Information */}
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${
                      isCrit
                        ? 'bg-rose-950/90 text-rose-400 border border-rose-800'
                        : isWarn
                        ? 'bg-amber-950/90 text-amber-400 border border-amber-800'
                        : 'bg-emerald-950/90 text-emerald-400 border border-emerald-800'
                    }`}
                  >
                    {isCrit ? <Flame className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-white">
                        {incident.camera_name}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                          isCrit
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : isWarn
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}
                      >
                        {incident.status}
                      </span>
                      <span className="text-rose-400 font-mono text-xs font-bold">
                        {incident.occlusion_ratio.toFixed(1)}% Occlusion
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 truncate mt-0.5">
                      {incident.location}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {incident.timestamp}
                      </span>
                      <span>ID: {incident.id}</span>
                      {incident.debris_types && incident.debris_types.length > 0 && (
                        <span className="text-slate-400">
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
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        incident.action_taken === 'DISPATCHED'
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                          : incident.action_taken === 'RESOLVED'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {incident.action_taken}
                    </span>
                  )}

                  {onSelectIncidentForRadio && (
                    <button
                      type="button"
                      onClick={() => onSelectIncidentForRadio(incident)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-cyan-950 text-slate-300 hover:text-cyan-300 border border-slate-700 hover:border-cyan-700 text-xs font-mono flex items-center gap-1.5 transition-colors"
                      title="Dispatch via Radio"
                    >
                      <Radio className="w-3 h-3" />
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
      <div className="p-3 bg-slate-900/80 border-t border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
        <span>Total Incidents: {filteredIncidents.length}</span>
        <span className="text-cyan-400">Offline SQLite: storage/incidents/</span>
      </div>
    </div>
  );

  if (isOpenAsDrawer) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="w-full max-w-xl h-full shadow-2xl border-l border-cyan-500/30 flex flex-col">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-eoc-border overflow-hidden shadow-lg bg-eoc-dark/90">
      {content}
    </div>
  );
};
