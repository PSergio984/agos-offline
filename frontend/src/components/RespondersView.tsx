import React, { useState, useEffect } from 'react';
import {
  Users,
  Bell,
  Send,
  Layers,
  FileText,
  Plus,
  Trash2,
  CheckCircle2,
  Phone,
  MapPin,
  Search,
  Check,
  X,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  Responder,
  ResponderGroup,
  NotificationTemplate,
  NotificationLog,
  ResponderNotificationPreferences,
} from '../types';
import {
  fetchResponders,
  createResponder,
  deleteResponder,
  fetchResponderGroups,
  createResponderGroup,
  deleteResponderGroup,
  fetchNotificationTemplates,
  createNotificationTemplate,
  deleteNotificationTemplate,
  sendAnnouncement,
  fetchNotificationLogs,
} from '../services/api';

type SubTabId = 'templates' | 'announce' | 'groups' | 'responders' | 'logs';

interface SubTabOption {
  id: SubTabId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SUB_TABS: SubTabOption[] = [
  { id: 'templates', name: 'Notification Templates', icon: FileText },
  { id: 'announce', name: 'Announce', icon: Send },
  { id: 'groups', name: 'Responder Groups', icon: Layers },
  { id: 'responders', name: 'Responders', icon: Users },
  { id: 'logs', name: 'Notification Logs', icon: Bell },
];

export const RespondersView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SubTabId>('templates');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Data states
  const [responders, setResponders] = useState<Responder[]>([]);
  const [groups, setGroups] = useState<ResponderGroup[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals state
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState<boolean>(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState<boolean>(false);
  const [isResponderModalOpen, setIsResponderModalOpen] = useState<boolean>(false);

  // Forms state
  const [templateForm, setTemplateForm] = useState({
    title: '',
    type: 'blockage',
    message: '',
  });

  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
  });

  const [responderForm, setResponderForm] = useState({
    first_name: '',
    last_name: '',
    phone_number: '',
    location: '',
    status: 'active',
    selected_group_id: '',
    preferences: {
      warning: true,
      critical: true,
      blockage: true,
      announcement: true,
    } as ResponderNotificationPreferences,
  });

  // Announce composer state
  const [announceForm, setAnnounceForm] = useState({
    selectedTemplateId: '',
    targetGroupId: '',
    title: 'Emergency Drainage Advisory',
    type: 'blockage',
    rawMessage: 'URGENT: Culvert grate blockage detected at {location}. Surface coverage: {occlusion_ratio}%. Immediate clearance required.',
    varLocation: 'Brgy. San Jose, Rizal Ave cor. Mabini St.',
    varOcclusion: '78.4',
    varTime: '20:30 PST',
  });
  const [isSendingAnnounce, setIsSendingAnnounce] = useState<boolean>(false);
  const [announceSuccessMsg, setAnnounceSuccessMsg] = useState<string | null>(null);

  // Load all records
  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [resp, grp, tmpl, lg] = await Promise.all([
        fetchResponders(),
        fetchResponderGroups(),
        fetchNotificationTemplates(),
        fetchNotificationLogs(),
      ]);
      setResponders(resp);
      setGroups(grp);
      setTemplates(tmpl);
      setLogs(lg);
      if (grp.length > 0 && !announceForm.targetGroupId) {
        setAnnounceForm((prev) => ({ ...prev, targetGroupId: grp[0].id }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Set default announce template if templates change
  useEffect(() => {
    if (templates.length > 0 && !announceForm.selectedTemplateId) {
      const first = templates[0];
      setAnnounceForm((prev) => ({
        ...prev,
        selectedTemplateId: first.id,
        title: first.title,
        type: first.type,
        rawMessage: first.message,
      }));
    }
  }, [templates]);

  // Handle template selection in Announce tab
  const handleTemplateSelect = (templateId: string) => {
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setAnnounceForm((prev) => ({
        ...prev,
        selectedTemplateId: tmpl.id,
        title: tmpl.title,
        type: tmpl.type,
        rawMessage: tmpl.message,
      }));
    }
  };

  // Compute live preview text for Announce tab
  const getRenderedAnnounceMessage = () => {
    let msg = announceForm.rawMessage;
    msg = msg.replace(/{location}/g, announceForm.varLocation || '[Location]');
    msg = msg.replace(/{occlusion_ratio}/g, announceForm.varOcclusion ? `${announceForm.varOcclusion}%` : '[Coverage%]');
    msg = msg.replace(/{time}/g, announceForm.varTime || '[Time]');
    return msg;
  };

  // Submit Announce
  const handleSendAnnounce = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSendingAnnounce(true);
    setAnnounceSuccessMsg(null);
    try {
      const result = await sendAnnouncement({
        title: announceForm.title,
        type: announceForm.type,
        message: getRenderedAnnounceMessage(),
        target_group_id: announceForm.targetGroupId || undefined,
      });

      if (result.success) {
        setAnnounceSuccessMsg(`Broadcast dispatched locally to ${result.recipient_count ?? 4} responders and queued for cloud sync!`);
        await loadAllData();
        setTimeout(() => setAnnounceSuccessMsg(null), 5000);
      }
    } finally {
      setIsSendingAnnounce(false);
    }
  };

  // Create Template
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateForm.title.trim() || !templateForm.message.trim()) return;
    await createNotificationTemplate({
      title: templateForm.title.trim(),
      type: templateForm.type,
      message: templateForm.message.trim(),
    });
    setTemplateForm({ title: '', type: 'blockage', message: '' });
    setIsTemplateModalOpen(false);
    await loadAllData();
  };

  // Delete Template
  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this notification template?')) return;
    await deleteNotificationTemplate(id);
    await loadAllData();
  };

  // Create Group
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name.trim()) return;
    await createResponderGroup({
      name: groupForm.name.trim(),
      description: groupForm.description.trim(),
    });
    setGroupForm({ name: '', description: '' });
    setIsGroupModalOpen(false);
    await loadAllData();
  };

  // Delete Group
  const handleDeleteGroup = async (id: string) => {
    if (!confirm('Are you sure you want to delete this responder group?')) return;
    await deleteResponderGroup(id);
    await loadAllData();
  };

  // Create Responder
  const handleCreateResponder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!responderForm.first_name.trim() || !responderForm.phone_number.trim()) return;
    await createResponder({
      first_name: responderForm.first_name.trim(),
      last_name: responderForm.last_name.trim(),
      phone_number: responderForm.phone_number.trim(),
      location: responderForm.location.trim(),
      status: responderForm.status,
      notif_preferences: responderForm.preferences,
      group_ids: responderForm.selected_group_id ? [responderForm.selected_group_id] : [],
    });
    setResponderForm({
      first_name: '',
      last_name: '',
      phone_number: '',
      location: '',
      status: 'active',
      selected_group_id: '',
      preferences: { warning: true, critical: true, blockage: true, announcement: true },
    });
    setIsResponderModalOpen(false);
    await loadAllData();
  };

  // Delete Responder
  const handleDeleteResponder = async (id: string) => {
    if (!confirm('Are you sure you want to remove this responder from local roster?')) return;
    await deleteResponder(id);
    await loadAllData();
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type.toLowerCase()) {
      case 'critical':
        return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800';
      case 'warning':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800';
      case 'blockage':
        return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800';
      default:
        return 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/80 dark:text-teal-300 dark:border-teal-800';
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header & Sub-Tab Navigation Bar */}
      <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-3 sm:p-4 shadow-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Mobile Dropdown */}
        <div className="sm:hidden w-full">
          <select
            value={activeSubTab}
            onChange={(e) => setActiveSubTab(e.target.value as SubTabId)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl p-2.5 outline-none"
          >
            {SUB_TABS.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.name}
              </option>
            ))}
          </select>
        </div>

        {/* Desktop Tab Buttons */}
        <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-teal-300' : 'text-slate-400'}`} />
                <span>{tab.name}</span>
              </button>
            );
          })}
        </div>

        {/* Right Actions: Refresh and Contextual 'New' Button */}
        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            type="button"
            onClick={loadAllData}
            disabled={isLoading}
            className="p-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 cursor-pointer shadow-xs"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-teal-500' : ''}`} />
          </button>

          {activeSubTab === 'templates' && (
            <button
              type="button"
              onClick={() => setIsTemplateModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Template</span>
            </button>
          )}

          {activeSubTab === 'groups' && (
            <button
              type="button"
              onClick={() => setIsGroupModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Group</span>
            </button>
          )}

          {activeSubTab === 'responders' && (
            <button
              type="button"
              onClick={() => setIsResponderModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Responder</span>
            </button>
          )}
        </div>
      </div>

      {/* SUB-TAB 1: Notification Templates */}
      {activeSubTab === 'templates' && (
        <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Pre-Configured Notification Templates
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Standardized disaster response copy with dynamic placeholders for air-gapped radio & SMS dispatches
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {templates.length} Templates
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="bg-white/90 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-3 shadow-xs hover:shadow-md transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase border ${getTypeBadgeClass(tmpl.type)}`}>
                      {tmpl.type}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(tmpl.id)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 transition-colors"
                      title="Delete template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-1.5">
                    {tmpl.title}
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-normal leading-relaxed bg-slate-50/80 dark:bg-slate-950/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/60 font-mono">
                    {tmpl.message}
                  </p>
                </div>

                {/* Variable Pills Highlight */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-medium">Variables:</span>
                    {tmpl.message.includes('{location}') && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800 font-mono">
                        {'{location}'}
                      </span>
                    )}
                    {tmpl.message.includes('{occlusion_ratio}') && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono">
                        {'{occlusion_ratio}'}
                      </span>
                    )}
                    {tmpl.message.includes('{time}') && (
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-mono">
                        {'{time}'}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAnnounceForm((prev) => ({
                        ...prev,
                        selectedTemplateId: tmpl.id,
                        title: tmpl.title,
                        type: tmpl.type,
                        rawMessage: tmpl.message,
                      }));
                      setActiveSubTab('announce');
                    }}
                    className="text-xs font-semibold text-primary dark:text-teal-400 hover:underline flex items-center gap-1"
                  >
                    <span>Use in Dispatch</span>
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Announce (Dispatch Composer) */}
      {activeSubTab === 'announce' && (
        <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl space-y-6">
          <div className="pb-3 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white">
                Local On-Premises Emergency Dispatch
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Compose emergency advisory, evaluate dynamic placeholders, and dispatch to responder groups offline
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Offline Dispatch Active</span>
            </div>
          </div>

          {announceSuccessMsg && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{announceSuccessMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 cols: Composer Form */}
            <form onSubmit={handleSendAnnounce} className="lg:col-span-7 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Template Selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Select Base Template
                  </label>
                  <select
                    value={announceForm.selectedTemplateId}
                    onChange={(e) => handleTemplateSelect(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.type})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target Group */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Target Responder Group
                  </label>
                  <select
                    value={announceForm.targetGroupId}
                    onChange={(e) => setAnnounceForm({ ...announceForm, targetGroupId: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                  >
                    <option value="">All Registered Responders ({responders.length})</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.member_count ?? 0} members)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Title & Type */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Announcement Title
                  </label>
                  <input
                    type="text"
                    required
                    value={announceForm.title}
                    onChange={(e) => setAnnounceForm({ ...announceForm, title: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Alert Type
                  </label>
                  <select
                    value={announceForm.type}
                    onChange={(e) => setAnnounceForm({ ...announceForm, type: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                  >
                    <option value="blockage">Blockage</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                    <option value="announcement">Announcement</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Variables Inputs */}
              <div className="bg-slate-50/80 dark:bg-slate-950/50 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide font-mono block">
                  Dynamic Placeholders Replacement:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono mb-0.5">
                      {'{location}'}
                    </label>
                    <input
                      type="text"
                      value={announceForm.varLocation}
                      onChange={(e) => setAnnounceForm({ ...announceForm, varLocation: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono mb-0.5">
                      {'{occlusion_ratio}'}
                    </label>
                    <input
                      type="text"
                      value={announceForm.varOcclusion}
                      onChange={(e) => setAnnounceForm({ ...announceForm, varOcclusion: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono mb-0.5">
                      {'{time}'}
                    </label>
                    <input
                      type="text"
                      value={announceForm.varTime}
                      onChange={(e) => setAnnounceForm({ ...announceForm, varTime: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Raw Message Textarea */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Message Body (Supports placeholders)
                </label>
                <textarea
                  rows={4}
                  required
                  value={announceForm.rawMessage}
                  onChange={(e) => setAnnounceForm({ ...announceForm, rawMessage: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-teal-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSendingAnnounce}
                className="w-full py-3 px-4 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold tracking-wide flex items-center justify-center gap-2 shadow-md shadow-primary/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4 text-teal-300" />
                <span>{isSendingAnnounce ? 'Broadcasting...' : 'Send Local Dispatch'}</span>
              </button>
            </form>

            {/* Right 5 cols: Live Preview */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-teal-500" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                        Live Dispatch Preview
                      </span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${getTypeBadgeClass(announceForm.type)}`}>
                      {announceForm.type}
                    </span>
                  </div>

                  {/* Simulated Mobile / Radio Message Bubble */}
                  <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-primary dark:text-teal-400">
                      <span>{announceForm.title || 'Untitled Alert'}</span>
                      <span className="text-[10px] text-slate-400 font-mono">Just Now</span>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans">
                      {getRenderedAnnounceMessage()}
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Target Group:</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {groups.find((g) => g.id === announceForm.targetGroupId)?.name || 'All Registered Responders'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Delivery Channel:</span>
                    <span className="font-semibold text-teal-600 dark:text-teal-400">
                      On-Premises Radio / Local SMS Queue
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Responder Groups */}
      {activeSubTab === 'groups' && (
        <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Emergency Responder Groups
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Organized task units and barangay quick response teams for targeted alerts
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {groups.length} Groups
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {groups.map((grp) => (
              <div
                key={grp.id}
                className="bg-white/90 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition-all gap-4"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 dark:bg-primary/30 text-primary dark:text-teal-400">
                      <Layers className="w-5 h-5" />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteGroup(grp.id)}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 transition-colors"
                      title="Delete group"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <h4 className="font-bold text-base text-slate-900 dark:text-white mb-1">
                    {grp.name}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {grp.description || 'No description provided.'}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60">
                    {grp.member_count ?? 0} Personnel
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    ID: {grp.id}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Responders (Personnel Directory) */}
      {activeSubTab === 'responders' && (
        <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-slate-800/80">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Personnel Directory
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Registered emergency responders with contact details and notification subscriptions
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search personnel..."
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {responders
              .filter(
                (r) =>
                  `${r.first_name} ${r.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  r.phone_number.includes(searchQuery) ||
                  r.location.toLowerCase().includes(searchQuery.toLowerCase())
              )
              .map((r) => {
                const prefs =
                  typeof r.notif_preferences === 'string'
                    ? JSON.parse(r.notif_preferences)
                    : r.notif_preferences;

                return (
                  <div
                    key={r.id}
                    className="bg-white/90 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition-all gap-3"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 dark:bg-primary/25 border border-primary/20 text-primary dark:text-teal-400 font-bold flex items-center justify-center text-xs">
                            {r.first_name[0]}
                            {r.last_name[0]}
                          </div>
                          <div>
                            <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                              {r.first_name} {r.last_name}
                            </h4>
                            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                              <Phone className="w-3 h-3 text-slate-400" />
                              <span className="font-mono">{r.phone_number}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase border ${
                              r.status === 'active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                                : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {r.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteResponder(r.id)}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-600 transition-colors"
                            title="Remove responder"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {r.location && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-2">
                          <MapPin className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                          <span className="truncate">{r.location}</span>
                        </div>
                      )}
                    </div>

                    {/* Notification Preferences Pills */}
                    <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1.5">
                        Alert Preferences:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {prefs?.blockage && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border border-red-200 dark:border-red-800">
                            Blockage
                          </span>
                        )}
                        {prefs?.critical && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                            Critical
                          </span>
                        )}
                        {prefs?.warning && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            Warning
                          </span>
                        )}
                        {prefs?.announcement && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                            Advisory
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* SUB-TAB 5: Notification Logs */}
      {activeSubTab === 'logs' && (
        <div className="bg-white/70 dark:bg-[#0B1526]/80 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Emergency Dispatch Audit Log
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Complete forensic archive of broadcasted alerts, recipient counts, and delivery status
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {logs.length} Logged Dispatches
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-800 dark:text-slate-200">
              <thead className="bg-slate-50/80 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 font-mono uppercase text-[10px] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Title & Message</th>
                  <th className="p-3">Target Group</th>
                  <th className="p-3">Recipients</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40 transition-colors">
                    <td className="p-3 whitespace-nowrap">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase border ${getTypeBadgeClass(log.type)}`}>
                        {log.type}
                      </span>
                    </td>
                    <td className="p-3 max-w-sm">
                      <div className="font-bold text-slate-900 dark:text-white">{log.title}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">
                        {log.message}
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                      {log.target_group_name || 'All Registered Responders'}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="font-mono font-bold text-teal-600 dark:text-teal-400">
                        {log.recipient_count}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                        <Check className="w-3 h-3" />
                        <span>{log.status}</span>
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {log.created_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: Create Template Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0B1526] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Create Notification Template</h3>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTemplate} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Template Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Curb Grate Blockage Alert"
                  value={templateForm.title}
                  onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alert Category
                </label>
                <select
                  value={templateForm.type}
                  onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                >
                  <option value="blockage">Blockage</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Message Body
                  </label>
                  <span className="text-[10px] text-slate-400">Click variable to insert:</span>
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  {['{location}', '{time}', '{occlusion_ratio}'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTemplateForm((prev) => ({ ...prev, message: prev.message + ` ${v}` }))}
                      className="px-2 py-0.5 text-[10px] rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-teal-600 dark:text-teal-400 font-mono border border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={4}
                  required
                  placeholder="Enter alert template message with variables..."
                  value={templateForm.message}
                  onChange={(e) => setTemplateForm({ ...templateForm, message: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-sm"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Create Group Modal */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0B1526] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Create Responder Group</h3>
              <button
                type="button"
                onClick={() => setIsGroupModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Group Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Barangay San Jose QRT"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Operational responsibilities and patrol area..."
                  value={groupForm.description}
                  onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsGroupModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-sm"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Responder Modal */}
      {isResponderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#0B1526] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Add Emergency Responder</h3>
              <button
                type="button"
                onClick={() => setIsResponderModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateResponder} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    required
                    value={responderForm.first_name}
                    onChange={(e) => setResponderForm({ ...responderForm, first_name: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    required
                    value={responderForm.last_name}
                    onChange={(e) => setResponderForm({ ...responderForm, last_name: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number (SMS / Local Radio Contact)
                </label>
                <input
                  type="text"
                  required
                  placeholder="+639171234567"
                  value={responderForm.phone_number}
                  onChange={(e) => setResponderForm({ ...responderForm, phone_number: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Station / Outpost Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. Barangay San Jose Outpost"
                  value={responderForm.location}
                  onChange={(e) => setResponderForm({ ...responderForm, location: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Assign to Group
                </label>
                <select
                  value={responderForm.selected_group_id}
                  onChange={(e) => setResponderForm({ ...responderForm, selected_group_id: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                >
                  <option value="">No initial group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notification Preferences Checkboxes */}
              <div className="bg-slate-50/80 dark:bg-slate-950/40 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-2 font-mono">
                  Subscribe to Alert Types:
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={responderForm.preferences.blockage}
                      onChange={(e) =>
                        setResponderForm({
                          ...responderForm,
                          preferences: { ...responderForm.preferences, blockage: e.target.checked },
                        })
                      }
                      className="rounded text-teal-600"
                    />
                    <span>Blockage</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={responderForm.preferences.critical}
                      onChange={(e) =>
                        setResponderForm({
                          ...responderForm,
                          preferences: { ...responderForm.preferences, critical: e.target.checked },
                        })
                      }
                      className="rounded text-rose-600"
                    />
                    <span>Critical</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={responderForm.preferences.warning}
                      onChange={(e) =>
                        setResponderForm({
                          ...responderForm,
                          preferences: { ...responderForm.preferences, warning: e.target.checked },
                        })
                      }
                      className="rounded text-amber-600"
                    />
                    <span>Warning</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={responderForm.preferences.announcement}
                      onChange={(e) =>
                        setResponderForm({
                          ...responderForm,
                          preferences: { ...responderForm.preferences, announcement: e.target.checked },
                        })
                      }
                      className="rounded text-teal-600"
                    />
                    <span>Advisory</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsResponderModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-sm"
                >
                  Save Responder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RespondersView;
