const BASE = (import.meta.env.VITE_API_URL || '') + '/api';

async function request(url, options = {}) {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Nagot gick fel');
  }
  return res.json();
}

// Foretag
export const getForetag = () => request('/foretag');
export const getOneForetag = (id) => request(`/foretag/${id}`);
export const createForetag = (data) => request('/foretag', { method: 'POST', body: JSON.stringify(data) });
export const updateForetag = (id, data) => request(`/foretag/${id}`, { method: 'PUT', body: JSON.stringify(data) });

// Nischer
export const getNischer = () => request('/influencers/nischer');

// Influencers
export const getInfluencers = (foretagId) => request(`/influencers/foretag/${foretagId}`);
export const findInfluencers = (foretagId) => request('/influencers/find', { method: 'POST', body: JSON.stringify({ foretagId }) });
export const findInfluencersMulti = (foretagId, plattform) => request('/influencers/find-multi', { method: 'POST', body: JSON.stringify({ foretagId, plattform }) });
export const toggleInfluencer = (id) => request(`/influencers/${id}/toggle`, { method: 'PUT' });
export const selectAllInfluencers = (foretagId, selected) => request(`/influencers/foretag/${foretagId}/select-all`, { method: 'PUT', body: JSON.stringify({ selected }) });
export const findEmailForInfluencer = (id, beskrivning) => request(`/influencers/${id}/find-email`, { method: 'POST', body: JSON.stringify({ beskrivning }) });
export const findAllEmails = (foretagId) => request(`/influencers/foretag/${foretagId}/find-emails`, { method: 'POST' });
export const bulkSaveInfluencers = (foretagId, influencers) => request('/influencers/bulk-save', { method: 'POST', body: JSON.stringify({ foretag_id: foretagId, influencers }) });
export const syncInfluencerSelection = (foretagId, selectedIds) => request(`/influencers/foretag/${foretagId}/sync-selection`, { method: 'PUT', body: JSON.stringify({ selectedIds }) });
export const manualImportInfluencer = (data) => request('/influencers/manual-import', { method: 'POST', body: JSON.stringify(data) });

// Outreach
export const getOutreach = (foretagId) => request(`/outreach/foretag/${foretagId}`);
export const getAllOutreach = () => request('/outreach');
export const generateOutreach = (foretagId) => request('/outreach/generate', { method: 'POST', body: JSON.stringify({ foretagId }) });
export const regenerateOutreach = (id) => request(`/outreach/${id}/regenerate`, { method: 'POST' });
export const updateOutreach = (id, data) => request(`/outreach/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteOutreach = (id) => request(`/outreach/${id}`, { method: 'DELETE' });
export const sendOutreach = (data) => request('/outreach/send', { method: 'POST', body: JSON.stringify(data) });
export const generateFollowUp = (id) => request(`/outreach/${id}/followup`, { method: 'POST' });
// Generera kontrakt — skickar all data direkt (ingen DB-lookup behövs)
export const generateKontraktDirect = async ({ kontaktperson, influencer, foretag, kontraktVillkor }) => {
  console.log(`[API] generateKontraktDirect influencer=${influencer?.namn}, foretag=${foretag?.namn}`);
  const res = await fetch(`${BASE}/outreach/generate-kontrakt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kontaktperson, influencer, foretag, kontraktVillkor }),
  });
  if (!res.ok) {
    let errMsg = `${res.status} ${res.statusText}`;
    try { const body = await res.json(); errMsg = body.error || errMsg; } catch {}
    console.error(`[API] generateKontraktDirect FAILED:`, errMsg);
    throw new Error(`Kunde inte generera kontrakt: ${errMsg}`);
  }
  return res.blob();
};

// Legacy: Generera kontrakt via meddelande-ID
export const generateKontrakt = async (id, kontaktperson) => {
  console.log(`[API] generateKontrakt id=${id}, kontaktperson=${kontaktperson}`);
  const res = await fetch(`${BASE}/outreach/${id}/kontrakt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kontaktperson }),
  });
  if (!res.ok) {
    let errMsg = `${res.status} ${res.statusText}`;
    try { const body = await res.json(); errMsg = body.error || errMsg; } catch {}
    console.error(`[API] generateKontrakt FAILED:`, errMsg);
    throw new Error(`Kunde inte generera kontrakt: ${errMsg}`);
  }
  return res.blob();
};

// Auth
export const getAuthStatus = () => request('/auth/status');
export const disconnectAuth = () => request('/auth/disconnect', { method: 'POST' });
export const connectSmtp = (data) => request('/auth/smtp/connect', { method: 'POST', body: JSON.stringify(data) });
export const testSmtp = (data) => request('/auth/smtp/test', { method: 'POST', body: JSON.stringify(data) });

// Dashboard
export const getDashboardStats = () => request('/dashboard/stats');
export const getFollowUps = () => request('/dashboard/followups');
export const dismissFollowUp = (id) => request(`/dashboard/followups/${id}/dismiss`, { method: 'POST' });
export const analyzeConversion = () => request('/dashboard/analyze', { method: 'POST' });
export const getDailySummary = () => request('/dashboard/daily-summary');
export const sendDailySummary = (email) => request('/dashboard/daily-summary/send', { method: 'POST', body: JSON.stringify({ email }) });
export const deepAnalyze = () => request('/dashboard/deep-analyze', { method: 'POST' });
export const getInfluencerRanking = () => request('/dashboard/ranking');
export const updateSignups = (influencerId, antal) => request(`/dashboard/ranking/${influencerId}/signups`, { method: 'POST', body: JSON.stringify({ antal }) });

// Auto-uppföljning (3-stegs sekvens)
export const getFollowupSettings = () => request('/followup-sequence/settings');
export const updateFollowupSettings = (data) => request('/followup-sequence/settings', { method: 'PUT', body: JSON.stringify(data) });
export const getFollowupDue = () => request('/followup-sequence/due');
export const processFollowup = (id, forceSend = false) => request(`/followup-sequence/process/${id}`, { method: 'POST', body: JSON.stringify({ forceSend }) });
export const runAutoFollowups = () => request('/followup-sequence/run', { method: 'POST' });
export const getFollowupStatus = () => request('/followup-sequence/status');
export const pauseFollowupSequence = (id, paused) => request(`/followup-sequence/pause/${id}`, { method: 'PUT', body: JSON.stringify({ paused }) });

// Sponsors
export const getSponsorProspects = (foretagId) => request(`/sponsors/prospects/${foretagId}`);
export const findSponsorProspects = (foretagId, exclude_names) => request('/sponsors/prospects/find', { method: 'POST', body: JSON.stringify({ foretagId, exclude_names }) });
export const toggleSponsorProspect = (id) => request(`/sponsors/prospects/${id}/toggle`, { method: 'PUT' });
export const selectAllProspects = (foretagId, selected) => request(`/sponsors/prospects/${foretagId}/select-all`, { method: 'PUT', body: JSON.stringify({ selected }) });
export const bulkSaveSponsorProspects = (foretagId, prospects) => request('/sponsors/prospects/bulk-save', { method: 'POST', body: JSON.stringify({ foretag_id: foretagId, prospects }) });
export const syncSponsorSelection = (foretagId, selectedIds) => request(`/sponsors/prospects/${foretagId}/sync-selection`, { method: 'PUT', body: JSON.stringify({ selectedIds }) });
export const generateSponsorOutreach = (foretagId, kanal, sponsorQuestions = {}) => request('/sponsors/outreach/generate', { method: 'POST', body: JSON.stringify({ foretagId, kanal, sponsorQuestions }) });
export const getSponsorOutreach = (foretagId) => request(`/sponsors/outreach/${foretagId}`);
export const updateSponsorOutreach = (id, data) => request(`/sponsors/outreach/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const sendSponsorOutreach = (messageIds) => request('/sponsors/outreach/send', { method: 'POST', body: JSON.stringify({ messageIds }) });

// Tracking
export const getTrackingStats = () => request('/tracking/stats');

// Content-bevakning
export const getContentOverview = () => request('/content/overview');
export const getContentVideos = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/content/videos${qs ? '?' + qs : ''}`);
};
export const triggerContentScan = () => request('/content/scan', { method: 'POST' });
export const analyzeVideo = (id) => request(`/content/videos/${id}/analyze`, { method: 'POST' });
export const getInfluencerContent = (id) => request(`/content/influencer/${id}`);

// Kontrakt-livscykel
export const getContractsOverview = () => request('/contracts/overview');
export const getContracts = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/contracts${qs ? '?' + qs : ''}`);
};
export const getContract = (id) => request(`/contracts/${id}`);
export const updateContractStatus = (id, status) => request(`/contracts/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
export const deleteContract = (id) => request(`/contracts/${id}`, { method: 'DELETE' });
export const updateContractEconomics = (id, data) => request(`/contracts/${id}/economics`, { method: 'PUT', body: JSON.stringify(data) });
export const sendForSigning = (id) => request(`/contracts/${id}/send-for-signing`, { method: 'POST' });
export const sendContractReminder = (id, type) => request(`/contracts/${id}/send-reminder`, { method: 'POST', body: JSON.stringify({ type }) });
export const getContractReminders = () => request('/contracts/reminders/due');
export const getContractPdfUrl = (id) => `${BASE}/contracts/${id}/pdf`;

// Invoices
export const getInvoicesOverview = () => request('/invoices/overview');
export const getInvoices = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/invoices${qs ? '?' + qs : ''}`);
};
export const getInvoice = (id) => request(`/invoices/${id}`);
export const generateInvoice = (kontraktId) => request('/invoices/generate', { method: 'POST', body: JSON.stringify({ kontrakt_id: kontraktId }) });
export const updateInvoiceStatus = (id, status) => request(`/invoices/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
export const sendInvoice = (id) => request(`/invoices/${id}/send`, { method: 'POST' });
export const getBillableContracts = () => request('/invoices/billable/contracts');
export const getInvoicePdfUrl = (id) => `${BASE}/invoices/${id}/pdf`;

// Analytics / ROI
export const getRoiOverview = () => request('/analytics/roi/overview');
export const getRoiRanking = () => request('/analytics/roi/ranking');
export const getRoiTimeline = () => request('/analytics/roi/timeline');
export const getRoiByPlatform = () => request('/analytics/roi/by-platform');
export const getRoiAiRecommendations = () => request('/analytics/roi/ai-recommendations', { method: 'POST' });
// Content submissions / godkännande
export const getContentSubmissions = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/content/submissions${qs ? '?' + qs : ''}`);
};
export const getContentSubmissionStats = () => request('/content/submissions/stats');
export const createContentSubmission = (data) => request('/content/submissions', { method: 'POST', body: JSON.stringify(data) });
export const reviewContentSubmission = (id, data) => request(`/content/submissions/${id}/review`, { method: 'PUT', body: JSON.stringify(data) });
export const resubmitContentSubmission = (id, data) => request(`/content/submissions/${id}/resubmit`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteContentSubmission = (id) => request(`/content/submissions/${id}`, { method: 'DELETE' });

// Kampanjer / Bulk-outreach
export const getKampanjer = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/kampanjer${qs ? '?' + qs : ''}`);
};
export const createKampanj = (data) => request('/kampanjer', { method: 'POST', body: JSON.stringify(data) });
export const getKampanj = (id) => request(`/kampanjer/${id}`);
export const updateKampanj = (id, data) => request(`/kampanjer/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteKampanj = (id) => request(`/kampanjer/${id}`, { method: 'DELETE' });
export const bulkGenerateOutreach = (id, influencer_ids) => request(`/kampanjer/${id}/bulk-generate`, { method: 'POST', body: JSON.stringify({ influencer_ids }) });
export const bulkSendOutreach = (id) => request(`/kampanjer/${id}/bulk-send`, { method: 'POST' });
export const getAvailableInfluencers = (id) => request(`/kampanjer/${id}/available-influencers`);

// A/B-testning
export const getAbTests = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/ab-tests${qs ? '?' + qs : ''}`);
};
export const createAbTest = (data) => request('/ab-tests', { method: 'POST', body: JSON.stringify(data) });
export const getAbTest = (id) => request(`/ab-tests/${id}`);
export const completeAbTest = (id) => request(`/ab-tests/${id}/complete`, { method: 'PUT' });
export const deleteAbTest = (id) => request(`/ab-tests/${id}`, { method: 'DELETE' });
export const getAbTestInsights = () => request('/ab-tests/insights/summary');

export const getRoiProfitability = () => request('/analytics/roi/profitability');
export const getRoiProfitTrend = () => request('/analytics/roi/profit-trend');
export const getRoiComparison = () => request('/analytics/roi/comparison');

// Intäkter
export const getIntakterOverview = () => request('/intakter/overview');
export const getIntakter = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/intakter${qs ? '?' + qs : ''}`);
};
export const getIntakt = (id) => request(`/intakter/${id}`);
export const createIntakt = (data) => request('/intakter', { method: 'POST', body: JSON.stringify(data) });
export const updateIntakt = (id, data) => request(`/intakter/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const updateIntaktStatus = (id, data) => request(`/intakter/${id}/status`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteIntakt = (id) => request(`/intakter/${id}`, { method: 'DELETE' });
export const getIntaktKampanjer = () => request('/intakter/meta/kampanjer');

// Automation
export const getAutomationStats = () => request('/automation/stats');
export const getInboxMessages = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/automation/inbox${qs ? '?' + qs : ''}`);
};
export const getAutomationLog = () => request('/automation/log');
export const getInboxConversations = () => request('/automation/inbox/conversations');
export const getInboxThread = (email) => request(`/automation/inbox/thread/${encodeURIComponent(email)}`);
export const sendInboxReply = (data) => request('/automation/inbox/reply', { method: 'POST', body: JSON.stringify(data) });
export const markInboxRead = (id) => request(`/automation/inbox/${id}/read`, { method: 'PUT' });

// Blacklist, Favoriter, Sparade sökningar
export const getBlacklist = () => request('/blacklist');
export const addToBlacklist = (data) => request('/blacklist', { method: 'POST', body: JSON.stringify(data) });
export const removeFromBlacklist = (id) => request(`/blacklist/${id}`, { method: 'DELETE' });
export const checkBlacklist = (params) => request(`/blacklist/check?${new URLSearchParams(params)}`);
export const blacklistFromOutreach = (infId, data) => request(`/blacklist/from-outreach/${infId}`, { method: 'POST', body: JSON.stringify(data) });
export const getFavorites = (foretagId) => request(`/blacklist/favorites${foretagId ? '?foretag_id=' + foretagId : ''}`);
export const addFavorite = (data) => request('/blacklist/favorites', { method: 'POST', body: JSON.stringify(data) });
export const updateFavorite = (id, data) => request(`/blacklist/favorites/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const removeFavorite = (id) => request(`/blacklist/favorites/${id}`, { method: 'DELETE' });
export const getSavedSearches = () => request('/blacklist/searches');
export const saveSearch = (data) => request('/blacklist/searches', { method: 'POST', body: JSON.stringify(data) });
export const deleteSavedSearch = (id) => request(`/blacklist/searches/${id}`, { method: 'DELETE' });

// Gmail Watcher — smart konversationsvy
export const checkGmailWatcher = () => request('/gmail-watcher/check');
export const getWatcherConversations = () => request('/gmail-watcher/conversations');
export const getWatcherThread = (email) => request(`/gmail-watcher/conversations/${encodeURIComponent(email)}/messages`);
export const analyzeMessage = (messageId) => request(`/gmail-watcher/analyze/${messageId}`, { method: 'POST' });
export const sendWatcherReply = (data) => request('/gmail-watcher/reply', { method: 'POST', body: JSON.stringify(data) });

// Rapporter
export const getReportData = (foretagId) => request(`/reports/roi-data${foretagId ? '?foretag_id=' + foretagId : ''}`);
export const downloadReport = (foretagId) => {
  const url = `${BASE}/reports/roi-summary${foretagId ? '?foretag_id=' + foretagId : ''}`;
  window.open(url, '_blank');
};

// Enrichment & Brief
export const enrichDomain = (domain) => request('/foretag/enrich', { method: 'POST', body: JSON.stringify({ domain }) });
export const getBriefQuestions = (enrichment_data, bransch, outreach_type) => request('/foretag/brief-questions', { method: 'POST', body: JSON.stringify({ enrichment_data, bransch, outreach_type }) });
export const saveCompanyProfile = (id, data) => request(`/foretag/${id}/profile`, { method: 'PUT', body: JSON.stringify(data) });

// Intelligent sökning
export const searchInfluencers = (company_profile_id, platforms, filters, exclude_handles) => request('/search/influencers', { method: 'POST', body: JSON.stringify({ company_profile_id, platforms, filters, exclude_handles }) });
export const filterSearchResults = (data) => request('/search/influencers/filter', { method: 'POST', body: JSON.stringify(data) });
export const getInfluencerProfile = (id) => request(`/search/influencer/${id}/profile`);
export const searchInfluencerDirect = (query, foretagId) => request('/influencers/search-direct', { method: 'POST', body: JSON.stringify({ query, foretagId }) });
export const searchSponsorDirect = (query, foretagId) => request('/sponsors/search-direct', { method: 'POST', body: JSON.stringify({ query, foretagId }) });

// Team
export const getTeamMembers = () => request('/team');
export const getTeamRoles = () => request('/team/roles');
export const getTeamStats = () => request('/team/stats');
export const getTeamActivity = (limit = 50) => request(`/team/activity?limit=${limit}`);
export const inviteTeamMember = (data) => request('/team/invite', { method: 'POST', body: JSON.stringify(data) });
export const updateTeamMember = (id, data) => request(`/team/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTeamMember = (id) => request(`/team/${id}`, { method: 'DELETE' });
export const logTeamActivity = (data) => request('/team/activity', { method: 'POST', body: JSON.stringify(data) });

// E-signering (publikt)
export const getSigningInfo = (token) => request(`/sign/${token}`);
export const submitSignature = (token, data) => request(`/sign/${token}`, { method: 'POST', body: JSON.stringify(data) });
export const getSigningPdfUrl = (token) => `${BASE}/sign/${token}/pdf`;

// Export
export const exportCsvUrl = (type) => `${BASE}/export/csv/${type}`;
export const exportPdfUrl = (outreachId) => `${BASE}/export/pdf/kontrakt/${outreachId}`;

// AI Agents — Managed Agents + AI-sökning
export const getAgentStatus = () => request('/agents/status');
export const setupAgents = () => request('/agents/setup', { method: 'POST' });
export const runAgentTask = (task, message) => request(`/agents/run/${task}`, { method: 'POST', body: JSON.stringify({ message }) });
export const aiSearchInfluencers = (data) => request('/agents/search', { method: 'POST', body: JSON.stringify(data) });
export const aiFindEmail = (data) => request('/agents/find-email', { method: 'POST', body: JSON.stringify(data) });
export const aiFindEmailsBatch = (influencers) => request('/agents/find-emails-batch', { method: 'POST', body: JSON.stringify({ influencers }) });
export const aiGenerateOutreach = (data) => request('/agents/generate-outreach', { method: 'POST', body: JSON.stringify(data) });
export const aiGenerateOutreachBatch = (data) => request('/agents/generate-outreach-batch', { method: 'POST', body: JSON.stringify(data) });
export const aiAnalyzeContent = (data) => request('/agents/analyze-content', { method: 'POST', body: JSON.stringify(data) });

// Chat-assistent
export const chatWithAI = (message, history = []) => request('/chat', { method: 'POST', body: JSON.stringify({ message, history }) });

// Admin Dashboard
export const getAdminCosts = (period = 'today') => request(`/admin/costs?period=${period}`);
export const getAdminAlerts = () => request('/admin/alerts');
export const getAdminSystemStatus = () => request('/admin/system-status');
export const getAdminCostsDaily = (days = 30) => request(`/admin/costs/daily?days=${days}`);
export const getAdminEnvCheck = () => request('/admin/env-check');
export const getAdminApolloTest = () => request('/admin/apollo-test');
export const getAdminApiStatus = () => request('/admin/api-status');
export const getAdminSerpApiStatus = () => request('/admin/serpapi-status');
export const getAdminCostsRealtime = () => request('/admin/costs/realtime');

// Sponsor-sökning (Apollo.io)
export const searchSponsors = (data) => request('/search/sponsors', { method: 'POST', body: JSON.stringify(data) });
export const searchSponsorContacts = (data) => request('/search/sponsors/contacts', { method: 'POST', body: JSON.stringify(data) });
