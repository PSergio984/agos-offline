import React, { useState, useEffect } from 'react';
import { Copy, Check, Radio, Mic, X, Send, MapPin, AlertCircle, Volume2, ShieldCheck, Users } from 'lucide-react';
import { sirenSynthesizer } from '../services/audioSiren';
import { fetchResponderGroups, fetchIncidentDispatchStatus, dispatchIncident } from '../services/api';
import { ResponderGroup, DispatchStatusResponse } from '../types';

interface RadioDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId?: string;
  cameraName: string;
  cameraId: string;
  location?: string;
  occlusionRatio: number;
  status: string;
  debrisTypes?: string[];
  initialRadioTicket?: string | null;
  targetGroupId?: string;
  onDispatched?: () => void;
  rainHazard?: boolean;
}

export const RadioDispatchModal: React.FC<RadioDispatchModalProps> = ({
  isOpen,
  onClose,
  incidentId,
  cameraName,
  location = 'Brgy. San Jose, Rizal Ave cor. Mabini St.',
  occlusionRatio,
  status,
  debrisTypes = ['Plastic Sacks', 'Vegetative Cluster', 'Styrofoam'],
  initialRadioTicket,
  targetGroupId,
  onDispatched,
  rainHazard = false,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedChannel, setSelectedChannel] = useState<string>('CH-14 (156.700 MHz DRRMO Tac 1)');
  const [groups, setGroups] = useState<ResponderGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [ticketId, setTicketId] = useState<string>('');
  const [dispatchStatus, setDispatchStatus] = useState<DispatchStatusResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [dispatchedSuccess, setDispatchedSuccess] = useState<boolean>(false);
  const [dispatchNotice, setDispatchNotice] = useState<{ type: 'success' | 'warning'; message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDispatchedSuccess(false);
      setDispatchNotice(null);
      return;
    }

    // 1. Fetch live responder groups from database
    fetchResponderGroups()
      .then((loadedGroups) => {
        setGroups(loadedGroups);
        if (loadedGroups.length > 0) {
          const preferred =
            targetGroupId && loadedGroups.some((g) => g.id === targetGroupId)
              ? targetGroupId
              : loadedGroups.find((g) => g.id === 'grp-drainage')?.id || loadedGroups[0].id;
          setSelectedGroupId(preferred);
        }
      })
      .catch((err) => {
        console.warn('[RadioDispatchModal] Failed to load responder groups:', err);
      });

    // 2. Fetch dispatch correlation status if incidentId is provided
    if (incidentId) {
      fetchIncidentDispatchStatus(incidentId)
        .then((s) => {
          setDispatchStatus(s);
          if (s?.radio_ticket) {
            setTicketId(s.radio_ticket);
          } else if (initialRadioTicket) {
            setTicketId(initialRadioTicket);
          } else {
            setTicketId(`RAD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
          }
        })
        .catch(() => {
          setTicketId(initialRadioTicket || `RAD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
        });
    } else {
      setTicketId(initialRadioTicket || `RAD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
    }
  }, [isOpen, incidentId, initialRadioTicket, targetGroupId]);

  if (!isOpen) return null;

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const assignedUnitName = selectedGroup ? selectedGroup.name : 'Drainage Maintenance Unit';
  const groupMemberCount = selectedGroup?.member_count ?? 0;
  const effectiveTicket = ticketId || 'RAD-PENDING';

  // The pre-formatted verbal script incorporating the shared ticket ID
  const radioScript = `Command to ${assignedUnitName}: Dispatch ticket ${effectiveTicket}. Drainage obstruction detected at ${cameraName}. Blockage level: ${occlusionRatio.toFixed(1)}%, Status ${status}. Immediate clearing required. Over.`;

  const handleCopy = async () => {
    sirenSynthesizer.playRadioClick();
    try {
      await navigator.clipboard.writeText(radioScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = radioScript;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleMarkDispatched = async () => {
    sirenSynthesizer.playRadioClick();
    setIsSubmitting(true);

    if (incidentId) {
      try {
        const res = await dispatchIncident(incidentId, {
          radio_ticket: effectiveTicket,
          channel: selectedChannel,
          assigned_group_id: selectedGroupId || undefined,
          send_sms: !dispatchStatus?.sms_dispatched,
        });

        if (res.sms_status === 'FAILED') {
          setDispatchNotice({
            type: 'warning',
            message: `Radio logged (${effectiveTicket}), SMS gateway offline - crew notified by radio only`,
          });
        } else if (res.sms_already_sent) {
          setDispatchNotice({
            type: 'success',
            message: `Voice radio confirmed for Ticket ${effectiveTicket} (SMS already recorded)`,
          });
        } else {
          setDispatchNotice({
            type: 'success',
            message: `Dual dispatch logged: Voice radio & SMS sent for Ticket ${effectiveTicket}`,
          });
        }
      } catch (err) {
        console.warn('[RadioDispatchModal] Backend dispatch error:', err);
        setDispatchNotice({
          type: 'warning',
          message: `Voice radio logged locally (${effectiveTicket})`,
        });
      }
    }

    setDispatchedSuccess(true);
    if (onDispatched) onDispatched();
    setTimeout(() => {
      setIsSubmitting(false);
      setDispatchedSuccess(false);
      onClose();
    }, 1400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col font-sans text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header */}
        <div className="p-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 dark:bg-primary/30 text-primary dark:text-teal-400 rounded-xl border border-primary/20 dark:border-teal-500/30 shadow-sm">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base tracking-tight">
                  Voice Radio Dispatch
                </h3>
                <span className="text-[10px] font-semibold bg-teal-50 text-teal-800 dark:bg-teal-500/10 dark:text-teal-300 border border-teal-200 dark:border-teal-500/20 px-2 py-0.5 rounded-full">
                  Ticket {effectiveTicket}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Dual-channel correlation: Voice VHF/UHF tactical radio & Android SMS Gateway
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4 text-sm text-slate-700 dark:text-slate-300">
          {/* Smart SMS Status Banner: Duplicate Prevention */}
          {dispatchStatus?.sms_dispatched ? (
            <div className="flex items-start justify-between bg-emerald-50 dark:bg-emerald-950/40 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-900 dark:text-emerald-200">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold flex items-center gap-1.5">
                    Automated SMS Already Dispatched
                    <span className="font-mono bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.2 rounded text-[10px]">
                      {effectiveTicket}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-800/90 dark:text-emerald-300/90 mt-0.5">
                    Alert delivered to {dispatchStatus.sms_details?.target_group_name || 'assigned crew'} (
                    {dispatchStatus.sms_details?.recipient_count || 1} phones). Radio confirmation will NOT duplicate SMS.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
                0 Duplicates
              </span>
            </div>
          ) : (
            <div className="flex items-start justify-between bg-teal-50/70 dark:bg-slate-950/60 p-3.5 rounded-xl border border-teal-200/80 dark:border-teal-500/20 text-xs text-teal-900 dark:text-teal-200">
              <div className="flex items-start gap-2.5">
                <Radio className="w-4 h-4 text-primary dark:text-teal-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold flex items-center gap-1.5">
                    Dual-Channel Dispatch Ready
                    <span className="font-mono bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300 px-1.5 py-0.2 rounded text-[10px]">
                      {effectiveTicket}
                    </span>
                  </div>
                  <p className="text-[11px] text-teal-800/90 dark:text-teal-300/90 mt-0.5">
                    Marking dispatched will log the radio ticket and send SMS details to {assignedUnitName}.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-semibold bg-teal-100 dark:bg-teal-900/70 text-teal-800 dark:text-teal-200 px-2 py-0.5 rounded-full whitespace-nowrap ml-2 flex items-center gap-1">
                <Users className="w-3 h-3" />
                {groupMemberCount} recipients
              </span>
            </div>
          )}

          {/* Tactical Channel & Unit Config */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Radio Frequency / Channel:
              </label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2 text-xs focus:border-teal-500 focus:outline-none shadow-sm cursor-pointer"
              >
                <option value="CH-14 (156.700 MHz DRRMO Tac 1)">CH-14 (156.700 MHz DRRMO Tac 1)</option>
                <option value="CH-08 (152.225 MHz Barangay Net)">CH-08 (152.225 MHz Barangay Net)</option>
                <option value="CH-03 (148.550 MHz DPWH/Engineering)">CH-03 (148.550 MHz DPWH/Engineering)</option>
                <option value="CH-01 (155.000 MHz City Emergency Call)">CH-01 (155.000 MHz City Emergency Call)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Assigned Team (Responder Group):
              </label>
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2 text-xs focus:border-teal-500 focus:outline-none shadow-sm cursor-pointer"
              >
                {groups.length > 0 ? (
                  groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.member_count ?? 0} phones)
                    </option>
                  ))
                ) : (
                  <>
                    <option value="grp-drainage">Drainage Maintenance Unit</option>
                    <option value="grp-poblacion">Barangay Poblacion QRT</option>
                    <option value="grp-evacuation">Evacuation Coordination Unit</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Incident Snapshot Summary */}
          <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl p-3.5 border border-slate-200/60 dark:border-slate-800/60 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-medium">
                <MapPin className="w-3.5 h-3.5 text-primary dark:text-teal-400" />
                <span>Location:</span>
              </span>
              <span className="text-slate-900 dark:text-slate-100 font-semibold">{location}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="font-medium">Trash Blockage:</span>
              <span className="text-rose-600 dark:text-rose-400 font-bold">
                {occlusionRatio.toFixed(1)}% ({status})
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="font-medium">Detected Debris:</span>
              <span className="text-amber-700 dark:text-amber-300 font-semibold">
                {debrisTypes.join(', ') || 'Solid waste cluster'}
              </span>
            </div>
          </div>

          {/* Pre-Formatted Verbal Radio Script (Primary Focus) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs font-bold text-teal-800 dark:text-teal-300">
                <Mic className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span>What to say on the radio:</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:flex items-center gap-1 font-medium">
                  <Volume2 className="w-3 h-3 text-slate-400" />
                  Standard Voice SOP
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-all shadow-xs active:scale-95 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-teal-300" />
                      <span>Copy Script</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <div className="w-full bg-teal-50/80 dark:bg-slate-950/80 p-4 rounded-xl border border-teal-200 dark:border-teal-500/30 text-teal-950 dark:text-teal-100 font-mono text-xs sm:text-sm leading-relaxed shadow-sm break-words select-all">
                "{radioScript}"
              </div>
            </div>
          </div>

          {rainHazard && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/40 p-3 rounded-xl border border-rose-300 dark:border-rose-800 text-[11px] text-rose-900 dark:text-rose-200 font-semibold"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <p>Rain hazard: heavy rainfall reported. Confirm responder safety before sending crews to the drain.</p>
            </div>
          )}

          {dispatchNotice && (
            <div
              className={`flex items-start gap-2 p-3 rounded-xl border text-[11px] font-semibold ${
                dispatchNotice.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <p>{dispatchNotice.message}</p>
            </div>
          )}

          {/* Operator Instructions Banner */}
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-slate-900/40 p-3 rounded-xl border border-amber-200/80 dark:border-slate-800/80 text-[11px] text-amber-900 dark:text-slate-300 font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p>
              Hold mic close. Key PTT switch for 1 second before speaking. Confirm callsign and Ticket {effectiveTicket} upon unit acknowledgment.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-300 dark:border-slate-800 transition-colors cursor-pointer shadow-sm"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-teal-700 dark:text-teal-300 border border-slate-300 dark:border-slate-800 transition-colors cursor-pointer shadow-sm"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleMarkDispatched}
              disabled={dispatchedSuccess || isSubmitting}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-md cursor-pointer ${
                dispatchedSuccess ? 'bg-emerald-600' : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {dispatchedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Logged in Queue</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-teal-300" />
                  <span>Mark Unit Dispatched</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
