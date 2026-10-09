import React, { useState, useEffect, useRef } from 'react';
import {
  Users,
  UserPlus,
  Bell,
  Send,
  Layers,
  FileText,
  Plus,
  ChevronDown,
  Trash2,
  CheckCircle2,
  Phone,
  MapPin,
  Search,
  Check,
  X,
  RefreshCw,
  Sparkles,
  Smartphone,
  Wifi,
  Radio,
  AlertTriangle,
  Edit3,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  Responder,
  ResponderGroup,
  NotificationTemplate,
  NotificationLog,
  ResponderNotificationPreferences,
  SmsGatewayConfig,
} from '../types';
import {
  fetchResponders,
  createResponder,
  deleteResponder,
  fetchResponderGroups,
  createResponderGroup,
  updateResponderGroup,
  deleteResponderGroup,
  fetchNotificationTemplates,
  createNotificationTemplate,
  deleteNotificationTemplate,
  sendAnnouncement,
  fetchNotificationLogs,
  fetchSmsConfig,
  updateSmsConfig,
  pingSmsGateway,
  testSmsGateway,
} from '../services/api';

type SubTabId = 'templates' | 'announce' | 'groups' | 'responders' | 'logs' | 'sms';

interface SubTabOption {
  id: SubTabId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SUB_TABS: SubTabOption[] = [
  { id: 'templates', name: 'Message Templates', icon: FileText },
  { id: 'announce', name: 'Send Alert', icon: Send },
  { id: 'groups', name: 'Responder Teams', icon: Layers },
  { id: 'responders', name: 'Responders List', icon: Users },
  { id: 'logs', name: 'Sent Alerts History', icon: Bell },
  { id: 'sms', name: 'SMS Gateway', icon: Smartphone },
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
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>('all');

  // Sent Alerts History Filter & Pagination
  const [logSearchQuery, setLogSearchQuery] = useState<string>('');
  const [logTypeFilter, setLogTypeFilter] = useState<string>('all');
  const [logTargetFilter, setLogTargetFilter] = useState<string>('all');
  const [logCurrentPage, setLogCurrentPage] = useState<number>(1);
  const [logItemsPerPage, setLogItemsPerPage] = useState<number>(10);

  // Modals state
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState<boolean>(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState<boolean>(false);
  const [editingGroup, setEditingGroup] = useState<ResponderGroup | null>(null);
  const [isResponderModalOpen, setIsResponderModalOpen] = useState<boolean>(false);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState<boolean>(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  // Forms state
  const [templateForm, setTemplateForm] = useState({
    title: '',
    type: 'blockage',
    message: '',
  });

  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    member_ids: [] as string[],
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
    title: 'Canal Blockage Alert',
    type: 'blockage',
    rawMessage: 'URGENT: Canal blockage detected at {location}. Blockage level: {blockage_level}%. Please clear immediately.',
    varLocation: 'Jiongco Creek, Brgy. Maysan, Valenzuela City',
    varOcclusion: '78.4',
    varTime: '20:30 PST',
  });
  const [isSendingAnnounce, setIsSendingAnnounce] = useState<boolean>(false);
  const [announceSuccessMsg, setAnnounceSuccessMsg] = useState<string | null>(null);

  // SMS Gateway state
  const [smsConfig, setSmsConfig] = useState<SmsGatewayConfig | null>(null);
  const [smsForm, setSmsForm] = useState({
    enabled: 1,
    mode: 'mock' as 'live' | 'mock',
    gateway_url: 'http://192.168.1.100:8080',
    api_key: 'admin:secret',
    cooldown_minutes: 15,
    max_retries: 3,
    default_group_id: 'grp-drainage',
  });
  const [smsPingResult, setSmsPingResult] = useState<{ status: string; message: string; pinged_at: string } | null>(null);
  const [isPingingSms, setIsPingingSms] = useState(false);
  const [isSavingSms, setIsSavingSms] = useState(false);
  const [smsSaveMsg, setSmsSaveMsg] = useState<string | null>(null);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [testMessage, setTestMessage] = useState('AGOS-Offline Test: Android SMS Gateway is active and operational.');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testStatusMsg, setTestStatusMsg] = useState<{ success: boolean; text: string } | null>(null);

  // Load all records
  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [resp, grp, tmpl, lg, smsCfg] = await Promise.all([
        fetchResponders(),
        fetchResponderGroups(),
        fetchNotificationTemplates(),
        fetchNotificationLogs(),
        fetchSmsConfig(),
      ]);
      setResponders(resp);
      setGroups(grp);
      setTemplates(tmpl);
      setLogs(lg);
      if (smsCfg) {
        setSmsConfig(smsCfg);
        setSmsForm({
          enabled: smsCfg.enabled,
          mode: smsCfg.mode,
          gateway_url: smsCfg.gateway_url,
          api_key: smsCfg.api_key,
          cooldown_minutes: smsCfg.cooldown_minutes,
          max_retries: smsCfg.max_retries,
          default_group_id: smsCfg.default_group_id || 'grp-drainage',
        });
        if (smsCfg.last_ping_status && smsCfg.last_ping_status !== 'UNKNOWN') {
          setSmsPingResult({
            status: smsCfg.last_ping_status,
            message: smsCfg.last_ping_status === 'ONLINE' ? 'Gateway verified online' : 'Gateway unreachable',
            pinged_at: smsCfg.last_ping_at || '',
          });
        }
      }
      if (grp.length > 0 && !announceForm.targetGroupId) {
        setAnnounceForm((prev) => ({ ...prev, targetGroupId: grp[0].id }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePingGateway = async () => {
    setIsPingingSms(true);
    try {
      const res = await pingSmsGateway();
      setSmsPingResult(res);
      if (smsConfig) {
        setSmsConfig({ ...smsConfig, last_ping_status: res.status, last_ping_at: res.pinged_at });
      }
    } catch (err: any) {
      setSmsPingResult({
        status: 'OFFLINE',
        message: err.message || 'Ping failed',
        pinged_at: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsPingingSms(false);
    }
  };

  const handleSaveSmsConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSms(true);
    setSmsSaveMsg(null);
    try {
      const updated = await updateSmsConfig(smsForm);
      setSmsConfig(updated);
      setSmsSaveMsg('SMS Gateway configuration saved successfully.');
      setTimeout(() => setSmsSaveMsg(null), 3000);
    } catch (err: any) {
      setSmsSaveMsg(`Failed to save: ${err.message}`);
    } finally {
      setIsSavingSms(false);
    }
  };

  const handleSendTestSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhoneNumber) return;
    setIsSendingTest(true);
    setTestStatusMsg(null);
    try {
      const res = await testSmsGateway({
        phone_number: testPhoneNumber,
        message: testMessage,
      });
      setTestStatusMsg({
        success: true,
        text: `Test SMS dispatched successfully (${res.mode === 'mock' ? 'Simulated' : 'Delivered via Phone'}).`,
      });
    } catch (err: any) {
      setTestStatusMsg({
        success: false,
        text: `Test SMS failed: ${err.message}`,
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // Close the New dropdown on outside click / Escape
  useEffect(() => {
    if (!isNewMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setIsNewMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNewMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isNewMenuOpen]);

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
    const val = announceForm.varOcclusion ? announceForm.varOcclusion.replace(/%$/, '') : '';
    const replacement = val ? `${val}%` : '[Blockage%]';
    msg = msg.replace(/{blockage_level}%/g, replacement);
    msg = msg.replace(/{blockage_level}/g, replacement);
    msg = msg.replace(/{occlusion_ratio}%/g, replacement);
    msg = msg.replace(/{occlusion_ratio}/g, replacement);
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
        setAnnounceSuccessMsg(`Alert dispatched locally to ${result.recipient_count ?? 4} responders and queued for cloud sync!`);
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

  // Open Group Modal for Creating
  const handleOpenCreateGroup = () => {
    setEditingGroup(null);
    setGroupForm({ name: '', description: '', member_ids: [] });
    setIsGroupModalOpen(true);
  };

  // Open Group Modal for Editing
  const handleOpenEditGroup = (group: ResponderGroup) => {
    setEditingGroup(group);
    // Find current member IDs assigned to this group either via group.member_ids or responders list
    const currentMemberIds = group.member_ids && group.member_ids.length > 0
      ? group.member_ids
      : responders.filter((r) => r.group_ids?.includes(group.id)).map((r) => r.id);

    setGroupForm({
      name: group.name,
      description: group.description || '',
      member_ids: currentMemberIds,
    });
    setIsGroupModalOpen(true);
  };

  // Toggle member selection in Group Form
  const handleToggleGroupMember = (responderId: string) => {
    setGroupForm((prev) => ({
      ...prev,
      member_ids: prev.member_ids.includes(responderId)
        ? prev.member_ids.filter((id) => id !== responderId)
        : [...prev.member_ids, responderId],
    }));
  };

  // Save (Create or Update) Group with members
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupForm.name.trim()) return;

    if (editingGroup) {
      await updateResponderGroup(editingGroup.id, {
        name: groupForm.name.trim(),
        description: groupForm.description.trim(),
        member_ids: groupForm.member_ids,
      });
    } else {
      await createResponderGroup({
        name: groupForm.name.trim(),
        description: groupForm.description.trim(),
        member_ids: groupForm.member_ids,
      });
    }

    setGroupForm({ name: '', description: '', member_ids: [] });
    setEditingGroup(null);
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

  const getTypeRibbonClass = (type: string) => {
    switch (type.toLowerCase()) {
      case 'critical':
        return 'bg-red-500';
      case 'warning':
        return 'bg-amber-500';
      case 'blockage':
        return 'bg-slate-700';
      case 'announcement':
        return 'bg-blue-500';
      case 'maintenance':
        return 'bg-emerald-600';
      case 'clear':
        return 'bg-teal-600';
      default:
        return 'bg-slate-500';
    }
  };

  const getTypeRibbonLabel = (type: string) => {
    switch (type.toLowerCase()) {
      case 'critical':
        return 'Critical Alert';
      case 'warning':
        return 'Warning Alert';
      case 'blockage':
        return 'Surface Obstruction Alert';
      case 'announcement':
        return 'Announcement';
      case 'maintenance':
        return 'Maintenance Advisory';
      case 'clear':
        return 'All Clear';
      default:
        return type;
    }
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type.toLowerCase()) {
      case 'critical':
        return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800';
      case 'warning':
        return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800';
      case 'blockage':
        return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-800';
      case 'maintenance':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800';
      case 'clear':
        return 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/80 dark:text-teal-300 dark:border-teal-800';
      default:
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800';
    }
  };

  return (
    <div className="space-y-3 flex flex-col">
      {/* Top Header & Sub-Tab Navigation Bar */}
      <div className="relative z-20 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl rounded-2xl py-3 px-4 text-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xl border border-white/50 dark:border-white/10 transition-all duration-300 hover:shadow-2xl">
        {/* Mobile Dropdown */}
        <div className="sm:hidden w-full">
          <select
            value={activeSubTab}
            onChange={(e) => setActiveSubTab(e.target.value as SubTabId)}
            className="w-full bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/5 text-gray-900 dark:text-slate-200 text-sm font-medium rounded-xl focus:ring-primary focus:border-primary block p-2.5 outline-none cursor-pointer truncate transition-colors"
          >
            {SUB_TABS.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.name}
              </option>
            ))}
          </select>
        </div>

        {/* Desktop Tab Buttons */}
        <div className="hidden sm:flex flex-wrap gap-1 flex-1">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-medium transition-colors duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-primary text-white dark:bg-blue-600'
                    : 'text-gray-600 hover:bg-white/50 hover:text-black dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="text-xs lg:text-sm">{tab.name}</span>
              </button>
            );
          })}
        </div>

        {/* Right Actions: SMS actions, Refresh, and New dropdown */}
        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          {activeSubTab === 'sms' && (
            <>
              <button
                type="button"
                onClick={handlePingGateway}
                disabled={isPingingSms}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/40 dark:bg-white/5 border border-gray-200/50 dark:border-white/10 text-gray-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/10 rounded-xl text-xs font-semibold transition-all cursor-pointer"
              >
                <Wifi className={`w-3.5 h-3.5 ${isPingingSms ? 'animate-pulse text-primary dark:text-blue-400' : ''}`} />
                <span>{isPingingSms ? 'Pinging...' : 'Ping Phone'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTestStatusMsg(null);
                  setIsTestModalOpen(true);
                }}
                className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white py-2.5 text-xs font-semibold"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Test SMS</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={loadAllData}
            disabled={isLoading}
            className="p-2 rounded-xl bg-white/40 dark:bg-white/5 border border-gray-200/50 dark:border-white/10 text-gray-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-primary dark:text-blue-400' : ''}`} />
          </button>

          <div className="relative" ref={newMenuRef}>
            <button
              type="button"
              onClick={() => setIsNewMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={isNewMenuOpen}
              className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white font-medium py-2.5"
            >
              <Plus className="w-5 h-5" />
              <span>New</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isNewMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isNewMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-48 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-xl shadow-2xl border border-white/50 dark:border-white/10 py-1.5 animate-dropdown-in z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsTemplateModalOpen(true);
                    setIsNewMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>New Template</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleOpenCreateGroup();
                    setIsNewMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>New Team</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsResponderModalOpen(true);
                    setIsNewMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>New Responder</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SUB-TAB 1: Message Templates */}
      {activeSubTab === 'templates' && (
        <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-white/10">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Message Templates
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Saved messages you can send to teams during heavy rain or blockage.
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {templates.length} Templates
            </span>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {[
              { id: 'all', label: 'All' },
              { id: 'blockage', label: 'Blockage' },
              { id: 'warning', label: 'Warning' },
              { id: 'critical', label: 'Critical' },
              { id: 'maintenance', label: 'Maintenance' },
              { id: 'announcement', label: 'Announcement' },
              { id: 'clear', label: 'All Clear' },
            ].map((cat) => {
              const count =
                cat.id === 'all'
                  ? templates.length
                  : templates.filter((t) => t.type.toLowerCase() === cat.id).length;
              const isActive = templateCategoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setTemplateCategoryFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-primary text-white shadow-sm dark:bg-blue-600'
                      : 'bg-white/40 dark:bg-white/[0.04] text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-white/[0.08] border border-gray-200/50 dark:border-white/10'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div className="pt-1">
              <div className="skeleton rounded-md w-full h-10" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton rounded-md w-full h-32" />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {templates
                .filter(
                  (t) =>
                    templateCategoryFilter === 'all' ||
                    t.type.toLowerCase() === templateCategoryFilter
                )
                .map((tmpl) => (
                <div
                  key={tmpl.id}
                  className="relative overflow-hidden p-4 border border-white/50 dark:border-white/10 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl rounded-2xl shadow-lg flex flex-col justify-between gap-3 transition-all duration-300 hover:shadow-xl hover:dark:border-white/20"
                >
                  <span
                    className={`absolute right-0 top-0 text-[10px] font-bold uppercase text-white px-2 py-1 rounded-bl-md ${getTypeRibbonClass(tmpl.type)}`}
                  >
                    {getTypeRibbonLabel(tmpl.type)}
                  </span>

                  <div>
                    <h4 className="font-medium text-sm text-slate-900 dark:text-slate-200 pr-28">
                      {tmpl.title}
                    </h4>
                    <p className="text-xs text-gray-700 dark:text-slate-400 font-normal leading-relaxed bg-white/40 dark:bg-white/[0.02] p-3 rounded-xl border border-gray-200/50 dark:border-white/5 font-mono mt-1.5">
                      {tmpl.message}
                    </p>
                  </div>

                  {/* Variable Pills Highlight */}
                  <div className="pt-2 border-t border-gray-100 dark:border-white/5 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Placeholders:</span>
                      {tmpl.message.includes('{location}') && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-mono">
                          {'{location}'}
                        </span>
                      )}
                      {(tmpl.message.includes('{blockage_level}') || tmpl.message.includes('{occlusion_ratio}')) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-mono">
                          {tmpl.message.includes('{blockage_level}') ? '{blockage_level}' : '{occlusion_ratio}'}
                        </span>
                      )}
                      {tmpl.message.includes('{time}') && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-mono">
                          {'{time}'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
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
                        className="text-xs font-semibold text-primary dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>Use in Send Alert</span>
                        <Send className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tmpl.id)}
                        className="flex items-center justify-center btn-custom bg-red-500 hover:bg-red-600 text-white p-2"
                        title="Delete template"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: Send Alert */}
      {activeSubTab === 'announce' && (
        <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl rounded-2xl p-5 sm:p-6 space-y-6">
          <div className="pb-3 border-b border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-base sm:text-lg text-slate-900 dark:text-slate-100">
                Send Alert to Team
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Choose a message template, check details, and send an alert to your responder teams.
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

                {/* Target Team */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Target Responder Team
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
                    Alert Title
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
                    <option value="maintenance">Maintenance</option>
                    <option value="announcement">Announcement</option>
                    <option value="clear">All Clear</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Variables Inputs */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800/60 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide font-mono block">
                  Placeholders Replacement:
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
                      {'{blockage_level}'} / {'{occlusion_ratio}'}
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
                className="w-full py-3 px-4 bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white rounded-xl text-xs font-bold tracking-wide flex items-center justify-center gap-2 shadow-md shadow-primary/20 transition-all cursor-pointer disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{isSendingAnnounce ? 'Sending Alert...' : 'Send Alert to Team'}</span>
              </button>
            </form>

            {/* Right 5 cols: Live Preview */}
            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 rounded-xl p-4 sm:p-5 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-teal-500" />
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider font-mono">
                        Message Preview (What will be sent)
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
                    <span>Target Team:</span>
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

      {/* SUB-TAB 3: Responder Teams */}
      {activeSubTab === 'groups' && (
        <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80 dark:border-white/10">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Responder Teams
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Emergency response teams ready to clear drains and help the community.
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
              {groups.length} Teams
            </span>
          </div>

          {isLoading ? (
            <div className="pt-1">
              <div className="skeleton h-10 w-full rounded-md" />
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton h-32 w-full rounded-md" />
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map((grp) => {
                const assignedResponders = responders.filter(
                  (r) => (grp.member_ids && grp.member_ids.includes(r.id)) || r.group_ids?.includes(grp.id)
                );
                return (
                  <div
                    key={grp.id}
                    className="flex flex-col gap-2 rounded-xl border border-gray-200/50 dark:border-white/10 bg-white/40 dark:bg-white/[0.02] p-4 transition-all duration-300 hover:bg-white/60 dark:hover:bg-white/[0.05] hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {grp.name}
                        </h4>
                        <span className="text-[10px] font-mono text-slate-400">
                          ID: {grp.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenEditGroup(grp)}
                          className="flex items-center gap-1 btn-custom bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60 px-2.5 py-1.5 text-xs font-medium cursor-pointer"
                          title="Edit team and members"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(grp.id)}
                          className="flex items-center justify-center btn-custom bg-red-500 hover:bg-red-600 text-white p-2 shrink-0 cursor-pointer"
                          title="Delete team"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-gray-700 dark:text-slate-400 leading-relaxed">
                      {grp.description || 'No description provided.'}
                    </p>

                    {/* Member Avatars / Names Chips */}
                    <div className="mt-1 flex flex-wrap gap-1.5 items-center">
                      {assignedResponders.slice(0, 4).map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 font-medium"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {m.first_name} {m.last_name}
                        </span>
                      ))}
                      {assignedResponders.length > 4 && (
                        <span className="text-[10px] font-mono font-medium text-slate-400 px-1.5 py-0.5">
                          +{assignedResponders.length - 4} more
                        </span>
                      )}
                      {assignedResponders.length === 0 && (
                        <span className="text-[11px] italic text-slate-400">
                          No responders assigned yet.
                        </span>
                      )}
                    </div>

                    <div className="mt-auto pt-3 border-t border-gray-100 dark:border-white/5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-medium">
                        <Users className="h-3.5 w-3.5 text-primary dark:text-blue-400" />
                        <span>{grp.member_count ?? assignedResponders.length} members assigned</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenEditGroup(grp)}
                        className="text-xs font-semibold text-primary dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        <span>Manage Roster</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: Responders List */}
      {activeSubTab === 'responders' && (
        <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80 dark:border-white/10">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Responders List
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Barangay responders and staff who receive alerts.
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-gray-500 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search responders..."
                className="w-full bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/5 rounded-xl pl-9 pr-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/20 dark:focus:ring-blue-500/20 transition-all"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3 pt-1">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton w-full h-14 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-gray-700 dark:text-slate-200">
                    <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 rounded-tl-xl uppercase tracking-wider text-[0.65rem] md:text-xs">
                      Responder
                    </th>
                    <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">
                      Phone Number
                    </th>
                    <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">
                      Location
                    </th>
                    <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">
                      Alert Preferences
                    </th>
                    <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">
                      Status
                    </th>
                    <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 rounded-tr-xl uppercase tracking-wider text-[0.65rem] md:text-xs">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {responders
                    .filter(
                      (r) =>
                        `${r.first_name} ${r.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        r.phone_number.includes(searchQuery) ||
                        r.location.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((r, index) => {
                      const prefs =
                        typeof r.notif_preferences === 'string'
                          ? JSON.parse(r.notif_preferences)
                          : r.notif_preferences;
                      const isEvenRow = index % 2 === 0;
                      const isActive = r.status.toLowerCase() === 'active';

                      return (
                        <tr
                          key={r.id}
                          className={`transition-all duration-200 text-gray-700 dark:text-slate-200 hover:bg-gray-100/50 dark:hover:bg-white/[0.03] ${
                            isEvenRow ? 'bg-white/40 dark:bg-transparent' : 'bg-gray-50/50 dark:bg-white/[0.01]'
                          }`}
                        >
                          <td className="px-4 py-3 text-left">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-blue-500/10 border border-primary/20 dark:border-blue-500/20 text-primary dark:text-blue-400 font-bold flex items-center justify-center text-[11px] shrink-0">
                                {r.first_name[0]}
                                {r.last_name[0]}
                              </div>
                              <span className="font-medium text-slate-900 dark:text-slate-200">
                                {r.first_name} {r.last_name}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-left">
                            <span className="inline-flex items-center gap-1.5 font-mono text-slate-700 dark:text-slate-300">
                              <Phone className="w-3 h-3 text-slate-400" />
                              {r.phone_number}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-left text-slate-500 dark:text-slate-400">
                            {r.location ? (
                              <span className="inline-flex items-center gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-primary dark:text-blue-400 shrink-0" />
                                <span className="whitespace-normal">{r.location}</span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-left whitespace-normal">
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
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                                  Advisory
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-left">
                            <span
                              className={`px-3 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1 w-fit ${
                                isActive
                                  ? 'bg-green-100 dark:bg-emerald-900/20 text-green-800 dark:text-emerald-400'
                                  : 'bg-gray-100 dark:bg-slate-700/50 text-gray-800 dark:text-slate-400'
                              }`}
                            >
                              {isActive && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-left">
                            <button
                              type="button"
                              onClick={() => handleDeleteResponder(r.id)}
                              className="flex items-center justify-center btn-custom bg-red-500 hover:bg-red-600 text-white p-2"
                              title="Remove responder"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}

                  {responders.filter(
                    (r) =>
                      `${r.first_name} ${r.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      r.phone_number.includes(searchQuery) ||
                      r.location.toLowerCase().includes(searchQuery.toLowerCase())
                  ).length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-6 text-center text-gray-500 dark:text-slate-400"
                      >
                        No responders found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: Sent Alerts History with Filters & Pagination */}
      {activeSubTab === 'logs' && (() => {
        const filteredLogs = logs.filter((log) => {
          const matchesType = logTypeFilter === 'all' || log.type.toLowerCase() === logTypeFilter.toLowerCase();
          const matchesTarget =
            logTargetFilter === 'all' ||
            (log.target_group_id ? log.target_group_id === logTargetFilter : logTargetFilter === 'all-responders');
          const q = logSearchQuery.toLowerCase().trim();
          const matchesSearch =
            !q ||
            log.title.toLowerCase().includes(q) ||
            log.message.toLowerCase().includes(q) ||
            (log.target_group_name && log.target_group_name.toLowerCase().includes(q)) ||
            log.status.toLowerCase().includes(q);

          return matchesType && matchesTarget && matchesSearch;
        });

        const totalPages = Math.max(1, Math.ceil(filteredLogs.length / logItemsPerPage));
        const safeCurrentPage = Math.min(logCurrentPage, totalPages);
        const startIndex = (safeCurrentPage - 1) * logItemsPerPage;
        const paginatedLogs = filteredLogs.slice(startIndex, startIndex + logItemsPerPage);

        const logTypeCounts = {
          all: logs.length,
          blockage: logs.filter((l) => l.type.toLowerCase() === 'blockage').length,
          warning: logs.filter((l) => l.type.toLowerCase() === 'warning').length,
          critical: logs.filter((l) => l.type.toLowerCase() === 'critical').length,
          maintenance: logs.filter((l) => l.type.toLowerCase() === 'maintenance').length,
          announcement: logs.filter((l) => l.type.toLowerCase() === 'announcement').length,
          clear: logs.filter((l) => l.type.toLowerCase() === 'clear').length,
        };

        return (
          <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-200/80 dark:border-white/10">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Sent Alerts History
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Search, filter by alert category or team, and inspect dispatched alerts.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400">
                  {filteredLogs.length} of {logs.length} Alerts
                </span>
              </div>
            </div>

            {/* Filter Controls Row */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Category Pills Filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
                {[
                  { id: 'all', label: 'All', count: logTypeCounts.all },
                  { id: 'blockage', label: 'Blockage', count: logTypeCounts.blockage },
                  { id: 'warning', label: 'Warning', count: logTypeCounts.warning },
                  { id: 'critical', label: 'Critical', count: logTypeCounts.critical },
                  { id: 'maintenance', label: 'Maintenance', count: logTypeCounts.maintenance },
                  { id: 'announcement', label: 'Advisory', count: logTypeCounts.announcement },
                  { id: 'clear', label: 'All Clear', count: logTypeCounts.clear },
                ].map((pill) => {
                  const isActive = logTypeFilter === pill.id;
                  return (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => {
                        setLogTypeFilter(pill.id);
                        setLogCurrentPage(1);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-primary text-white shadow-xs dark:bg-blue-600'
                          : 'bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-white/10'
                      }`}
                    >
                      <span>{pill.label}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {pill.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Search & Team Filter */}
              <div className="flex items-center gap-2 self-stretch md:self-auto shrink-0">
                {/* Target Team Dropdown */}
                <select
                  value={logTargetFilter}
                  onChange={(e) => {
                    setLogTargetFilter(e.target.value);
                    setLogCurrentPage(1);
                  }}
                  className="bg-white/60 dark:bg-slate-900 border border-gray-200/50 dark:border-white/10 rounded-xl px-2.5 py-2 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="all">All Teams / Recipients</option>
                  <option value="all-responders">All Registered Responders</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>

                {/* Search Input */}
                <div className="relative flex-1 md:w-56">
                  <Search className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={logSearchQuery}
                    onChange={(e) => {
                      setLogSearchQuery(e.target.value);
                      setLogCurrentPage(1);
                    }}
                    placeholder="Search logs..."
                    className="w-full bg-white/60 dark:bg-slate-900 border border-gray-200/50 dark:border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-800 dark:text-slate-200 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3 pt-1">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="skeleton w-full h-14 rounded-md" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                  <thead>
                    <tr className="text-gray-700 dark:text-slate-200">
                      <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 rounded-tl-xl uppercase tracking-wider text-[0.65rem] md:text-xs">Type</th>
                      <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">Title & Message</th>
                      <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">Target Team</th>
                      <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">Recipients</th>
                      <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 uppercase tracking-wider text-[0.65rem] md:text-xs">Status</th>
                      <th className="px-4 py-3.5 font-bold text-left bg-gray-100 dark:bg-slate-800 rounded-tr-xl uppercase tracking-wider text-[0.65rem] md:text-xs">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLogs.map((log, index) => (
                      <tr
                        key={log.id}
                        className={`transition-all duration-200 text-gray-700 dark:text-slate-200 hover:bg-gray-100/50 dark:hover:bg-white/[0.03] ${
                          index % 2 === 0 ? 'bg-white/40 dark:bg-transparent' : 'bg-gray-50/50 dark:bg-white/[0.01]'
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase border ${getTypeBadgeClass(log.type)}`}>
                            {log.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-sm whitespace-normal">
                          <div className="font-bold text-slate-900 dark:text-slate-100">{log.title}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">
                            {log.message}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                          {log.target_group_name || 'All Registered Responders'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-primary dark:text-blue-400">
                            {log.recipient_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                            <Check className="w-3 h-3" />
                            <span>{log.status}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                          {log.created_at}
                        </td>
                      </tr>
                    ))}

                    {filteredLogs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                          No alerts match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls Footer */}
            {filteredLogs.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-200/80 dark:border-white/10 text-xs">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span>
                    Showing <span className="font-semibold text-slate-800 dark:text-slate-200">{startIndex + 1}</span> to{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {Math.min(startIndex + logItemsPerPage, filteredLogs.length)}
                    </span>{' '}
                    of <span className="font-semibold text-slate-800 dark:text-slate-200">{filteredLogs.length}</span> records
                  </span>

                  <span className="hidden sm:inline text-slate-300 dark:text-slate-700">•</span>

                  <div className="flex items-center gap-1">
                    <span>Per page:</span>
                    <select
                      value={logItemsPerPage}
                      onChange={(e) => {
                        setLogItemsPerPage(Number(e.target.value));
                        setLogCurrentPage(1);
                      }}
                      className="bg-transparent border border-slate-200 dark:border-slate-800 rounded-lg px-1.5 py-0.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setLogCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safeCurrentPage <= 1}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-1 font-mono text-xs text-slate-600 dark:text-slate-300 px-2">
                    <span className="font-bold text-slate-900 dark:text-slate-100">{safeCurrentPage}</span>
                    <span className="text-slate-400">/</span>
                    <span>{totalPages}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setLogCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safeCurrentPage >= totalPages}
                    className="p-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    title="Next Page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* SUB-TAB 6: Phone SMS Gateway */}
      {activeSubTab === 'sms' && (
        <div className="space-y-6">
          {/* Status Alert Banner */}
          <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
            smsForm.mode === 'mock'
              ? 'bg-amber-50/80 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40 text-amber-900 dark:text-amber-200'
              : smsPingResult?.status === 'ONLINE'
              ? 'bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50/80 border-rose-200 dark:bg-rose-950/20 dark:border-rose-800/40 text-rose-900 dark:text-rose-200'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${
                smsForm.mode === 'mock'
                  ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400'
                  : smsPingResult?.status === 'ONLINE'
                  ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400'
              }`}>
                {smsForm.mode === 'mock' ? (
                  <Radio className="w-5 h-5" />
                ) : smsPingResult?.status === 'ONLINE' ? (
                  <Smartphone className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="font-bold text-sm flex items-center gap-2">
                  <span>
                    {smsForm.mode === 'mock'
                      ? 'Simulation (Mock) Mode Active'
                      : smsPingResult?.status === 'ONLINE'
                      ? 'Android Phone Gateway Online'
                      : 'Phone Gateway Unreachable'}
                  </span>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase font-bold border ${
                    smsForm.mode === 'mock'
                      ? 'bg-amber-100/60 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300'
                      : smsPingResult?.status === 'ONLINE'
                      ? 'bg-emerald-100/60 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-rose-100/60 text-rose-700 border-rose-300 dark:bg-rose-900/40 dark:text-rose-300'
                  }`}>
                    {smsForm.mode}
                  </span>
                </div>
                <p className="text-xs opacity-90 mt-0.5">
                  {smsPingResult?.message || (smsForm.mode === 'mock'
                    ? 'Dispatches are simulated and recorded to logs without physical phone hardware.'
                    : 'Targeting local Android SMSGate HTTP endpoint.')}
                </p>
              </div>
            </div>

            {smsPingResult?.pinged_at && (
              <span className="text-[11px] font-mono opacity-70">
                Last verified: {smsPingResult.pinged_at}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Settings Form */}
            <div className="lg:col-span-2 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 shadow-xl rounded-2xl p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-white/10">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                    Gateway Configuration
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Connect an Android phone running SMSGate over local Wi-Fi or hotspot.
                  </p>
                </div>
                {smsSaveMsg && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-1 rounded-xl animate-in fade-in">
                    {smsSaveMsg}
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveSmsConfig} className="space-y-4">
                {/* Operating Mode Selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Operating Mode
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSmsForm({ ...smsForm, mode: 'mock' })}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        smsForm.mode === 'mock'
                          ? 'bg-primary/10 border-primary text-slate-900 dark:text-white shadow-xs'
                          : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-primary" />
                        <span>Mock Mode (Dev/Sim)</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        No phone needed. Logs SMS to database & console.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSmsForm({ ...smsForm, mode: 'live' })}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        smsForm.mode === 'live'
                          ? 'bg-primary/10 border-primary text-slate-900 dark:text-white shadow-xs'
                          : 'bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <div className="font-bold text-xs flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-primary" />
                        <span>Live Android Phone</span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Sends real SMS via local SMSGate HTTP endpoint.
                      </p>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Gateway URL */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Gateway URL (Phone IP & Port)
                    </label>
                    <input
                      type="text"
                      value={smsForm.gateway_url}
                      onChange={(e) => setSmsForm({ ...smsForm, gateway_url: e.target.value })}
                      placeholder="http://192.168.1.100:8080"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Shown on the SMSGate app dashboard.
                    </p>
                  </div>

                  {/* API Credentials */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Credentials (username:password)
                    </label>
                    <input
                      type="text"
                      value={smsForm.api_key}
                      onChange={(e) => setSmsForm({ ...smsForm, api_key: e.target.value })}
                      placeholder="admin:secret"
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Configured in SMSGate authentication settings.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Cooldown Minutes */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Alert Cooldown (Minutes)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={smsForm.cooldown_minutes}
                      onChange={(e) => setSmsForm({ ...smsForm, cooldown_minutes: parseInt(e.target.value) || 15 })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Throttles repeated SMS during sustained blockage.
                    </p>
                  </div>

                  {/* Max Retries */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Max Retries
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={smsForm.max_retries}
                      onChange={(e) => setSmsForm({ ...smsForm, max_retries: parseInt(e.target.value) || 3 })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Retries on timeout or network drop.
                    </p>
                  </div>

                  {/* Default Fallback Group */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Default Team Target
                    </label>
                    <select
                      value={smsForm.default_group_id}
                      onChange={(e) => setSmsForm({ ...smsForm, default_group_id: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                    >
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Fallback if camera has no assigned team.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-slate-200/80 dark:border-white/10">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(smsForm.enabled)}
                      onChange={(e) => setSmsForm({ ...smsForm, enabled: e.target.checked ? 1 : 0 })}
                      className="rounded text-primary focus:ring-primary dark:text-blue-500 dark:focus:ring-blue-500"
                    />
                    <span>Enable Outbound SMS Alerts</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSavingSms}
                    className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white py-2 text-xs font-bold"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSavingSms ? 'Saving...' : 'Save Configuration'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Operator Quick Guide */}
            <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 rounded-2xl shadow-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100 font-bold text-sm">
                <Smartphone className="w-4 h-4 text-primary" />
                <span>Zero-Cost Phone Setup</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Replace paid SMS APIs (like Semaphore) with an Android smartphone using the open-source <strong>SMSGate</strong> app.
              </p>

              <ol className="space-y-3 text-xs text-slate-600 dark:text-slate-400 list-decimal list-inside leading-relaxed font-sans">
                <li>
                  <strong>Install App:</strong> Install SMSGate on the Android phone with active SIM card.
                </li>
                <li>
                  <strong>Local Network:</strong> Connect phone and PC to the same Wi-Fi router, or turn on the <em>Phone Hotspot</em> and connect this PC.
                </li>
                <li>
                  <strong>Enable Server:</strong> In SMSGate, start the Local HTTP Server on port 8080.
                </li>
                <li>
                  <strong>Configure:</strong> Enter the phone's IP shown on the app into Gateway URL above and save.
                </li>
              </ol>

              <div className="p-3 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/40 rounded-xl text-[11px] text-teal-800 dark:text-teal-300">
                💡 <strong>Tip:</strong> Automated drainage alerts use your <em>Message Templates</em> and automatically inject location and occlusion percentage.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Send Test SMS Modal */}
      {isTestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-white/10 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100 custom-scrollbar max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Send Test SMS</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsTestModalOpen(false)}
                className="p-1.5 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {testStatusMsg && (
              <div className={`p-3 rounded-xl text-xs font-medium border ${
                testStatusMsg.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800'
              }`}>
                {testStatusMsg.text}
              </div>
            )}

            <form onSubmit={handleSendTestSms} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Recipient Mobile Number
                </label>
                <input
                  type="text"
                  placeholder="+639171234567"
                  value={testPhoneNumber}
                  onChange={(e) => setTestPhoneNumber(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Message Content
                </label>
                <textarea
                  rows={3}
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTestModalOpen(false)}
                  className="btn-cancel py-2 text-xs font-medium"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSendingTest}
                  className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white py-2 text-xs font-bold"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSendingTest ? 'Sending...' : 'Dispatch Test SMS'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: Create Template Modal */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-white/10 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100 custom-scrollbar max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Create Message Template</h3>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="p-1.5 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
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
                  placeholder="e.g. Canal Blockage Alert"
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
                  <option value="maintenance">Maintenance</option>
                  <option value="announcement">Announcement</option>
                  <option value="clear">All Clear</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Message Body
                  </label>
                  <span className="text-[10px] text-slate-400">Click placeholder to insert:</span>
                </div>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  {['{location}', '{time}', '{blockage_level}', '{occlusion_ratio}'].map((v) => (
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
                  placeholder="Enter alert template message with placeholders..."
                  value={templateForm.message}
                  onChange={(e) => setTemplateForm({ ...templateForm, message: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTemplateModalOpen(false)}
                  className="btn-cancel py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white py-2 text-xs font-bold"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Create / Edit Team Modal with Member Roster Management */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-white/10 dark:border-slate-800 rounded-2xl max-w-lg w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100 custom-scrollbar max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-primary dark:text-blue-400" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {editingGroup ? `Edit Team: ${editingGroup.name}` : 'Create Responder Team'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsGroupModalOpen(false);
                  setEditingGroup(null);
                }}
                className="p-1.5 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Team Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Barangay San Jose QRT"
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Operational responsibilities and patrol area..."
                  value={groupForm.description}
                  onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>

              {/* Select Team Members */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Assign Team Members ({groupForm.member_ids.length} selected)
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Total: {responders.length} responders
                  </span>
                </div>

                <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-2 space-y-1.5 custom-scrollbar">
                  {responders.map((r) => {
                    const isSelected = groupForm.member_ids.includes(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors border ${
                          isSelected
                            ? 'bg-primary/10 border-primary/40 dark:bg-blue-500/10 dark:border-blue-500/40'
                            : 'bg-white dark:bg-slate-800/40 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/80'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleGroupMember(r.id)}
                            className="rounded text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                          />
                          <div>
                            <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                              {r.first_name} {r.last_name}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {r.phone_number} {r.location ? `• ${r.location}` : ''}
                            </div>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            r.status.toLowerCase() === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {r.status}
                        </span>
                      </label>
                    );
                  })}

                  {responders.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No responders registered yet. Add responders first to assign them to teams.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsGroupModalOpen(false);
                    setEditingGroup(null);
                  }}
                  className="btn-cancel py-2 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white py-2 text-xs font-bold cursor-pointer"
                >
                  {editingGroup ? 'Save Team Changes' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Responder Modal */}
      {isResponderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-white/10 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 shadow-2xl flex flex-col gap-4 text-slate-800 dark:text-slate-100 custom-scrollbar max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Add Responder</h3>
              <button
                type="button"
                onClick={() => setIsResponderModalOpen(false)}
                className="p-1.5 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
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
                  Assign to Team
                </label>
                <select
                  value={responderForm.selected_group_id}
                  onChange={(e) => setResponderForm({ ...responderForm, selected_group_id: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                >
                  <option value="">No initial team</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notification Preferences Checkboxes */}
              <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/60">
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
                  className="btn-cancel py-2 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white py-2 text-xs font-bold"
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
