import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings, Play, CheckCircle, AlertCircle, Loader2, 
  Mail, User, Copy, RotateCcw, FileText, ChevronRight, 
  Sparkles, Check, LogOut, Terminal, Award
} from 'lucide-react';

const API_BASE = 'http://localhost:8000/api';

export default function App() {
  const [settings, setSettings] = useState({ openai_api_key_set: false, serper_api_key_set: false });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [serperKeyInput, setSerperKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [leads, setLeads] = useState([]);
  const [activeRunId, setActiveRunId] = useState(null);
  const [runData, setRunData] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [copiedCandidate, setCopiedCandidate] = useState(null);
  const [selectedCandidateEmail, setSelectedCandidateEmail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const logEndRef = useRef(null);

  // Fetch initial leads and key configuration
  useEffect(() => {
    fetchLeads();
    checkSettings();
  }, []);

  // Poll active run data
  useEffect(() => {
    let interval;
    if (activeRunId) {
      fetchRunData(); // Immediate fetch
      interval = setInterval(() => {
        fetchRunData();
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [activeRunId]);

  // Scroll logs to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [runData?.logs]);

  const checkSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      const data = await res.json();
      setSettings(data);
      if (!data.openai_api_key_set) {
        setShowSettings(true); // Prompt setting API keys if not configured
      }
    } catch (e) {
      console.error('Error fetching settings status', e);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    if (!apiKeyInput) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openai_api_key: apiKeyInput,
          serper_api_key: serperKeyInput
        })
      });
      if (res.ok) {
        await checkSettings();
        setShowSettings(false);
        setApiKeyInput('');
        setSerperKeyInput('');
      } else {
        const error = await res.json();
        alert(`Error: ${error.detail}`);
      }
    } catch (e) {
      alert('Failed to connect to the backend server.');
    } finally {
      setActionLoading(false);
    }
  };

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leads`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data);
      }
    } catch (e) {
      console.error('Error fetching leads', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchRunData = async () => {
    if (!activeRunId) return;
    try {
      const res = await fetch(`${API_BASE}/runs/${activeRunId}`);
      if (res.ok) {
        const data = await res.json();
        setRunData(data);
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'quit') {
          // If the flow has finished, stop polling eventually or keep it viewable
        }
      }
    } catch (e) {
      console.error('Error fetching run details', e);
    }
  };

  const startCampaign = async () => {
    if (!settings.openai_api_key_set) {
      setShowSettings(true);
      return;
    }
    setActionLoading(true);
    setSelectedCandidateEmail(null);
    setRunData(null);
    try {
      const res = await fetch(`${API_BASE}/runs`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setActiveRunId(data.run_id);
      } else {
        const error = await res.json();
        alert(`Failed to start campaign: ${error.detail}`);
      }
    } catch (e) {
      alert('Error connecting to backend API.');
    } finally {
      setActionLoading(false);
    }
  };

  const submitChoice = async (choice) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/runs/${activeRunId}/choice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choice: choice,
          feedback: choice === '2' ? feedback : ''
        })
      });
      if (res.ok) {
        setFeedback('');
        // Rerun fetch to get updated status immediately
        await fetchRunData();
      } else {
        const error = await res.json();
        alert(`Error submitting choice: ${error.detail}`);
      }
    } catch (e) {
      alert('Network error when sending choice.');
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text, name) => {
    navigator.clipboard.writeText(text);
    setCopiedCandidate(name);
    setTimeout(() => setCopiedCandidate(null), 2000);
  };

  const resetFlow = () => {
    setActiveRunId(null);
    setRunData(null);
    fetchLeads();
  };

  // Helper to render status badges
  const getStatusBadge = (status) => {
    const styles = {
      idle: 'bg-gray-800 text-gray-400 border border-gray-700',
      running: 'bg-indigo-900/50 text-indigo-300 border border-indigo-700 pulse-indicator',
      waiting_for_human: 'bg-purple-900/50 text-purple-300 border border-purple-700',
      generating_emails: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700 pulse-indicator',
      completed: 'bg-emerald-900/50 text-emerald-300 border border-emerald-700',
      failed: 'bg-red-900/50 text-red-300 border border-red-700',
      quit: 'bg-orange-900/50 text-orange-300 border border-orange-700',
    };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${styles[status] || styles.idle}`}>
        {status?.replace('_', ' ')}
      </span>
    );
  };

  // Stepper helper
  const getStepStatus = (stepName) => {
    if (!runData) return 'idle';
    const status = runData.status;
    const stages = ['running', 'waiting_for_human', 'generating_emails', 'completed'];
    const currentIdx = stages.indexOf(status);

    if (status === 'failed') return 'failed';
    if (status === 'quit') return 'quit';

    if (stepName === 'load') {
      return 'completed'; // Always complete if we started
    }
    if (stepName === 'score') {
      if (status === 'running') return 'active';
      if (stages.indexOf(status) > 0) return 'completed';
    }
    if (stepName === 'human') {
      if (status === 'waiting_for_human') return 'active';
      if (stages.indexOf(status) > 1) return 'completed';
    }
    if (stepName === 'emails') {
      if (status === 'generating_emails') return 'active';
      if (status === 'completed') return 'completed';
    }
    return 'idle';
  };

  return (
    <div className="max-w-6xl mx-auto min-h-screen pb-12">
      {/* Meta/Title tags simulated for SEO */}
      <header className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-600/40">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 id="app-title" className="text-2xl font-extrabold tracking-tight text-white m-0">
              CrewAI <span className="text-indigo-400">Lead Flow Portal</span>
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">Automated Lead Scoring and Follow-up Outreach</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button 
            id="settings-btn"
            onClick={() => setShowSettings(true)}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/50 text-sm font-semibold transition"
          >
            <Settings className={`h-4 w-4 ${settings.openai_api_key_set ? 'text-emerald-400' : 'text-yellow-400'}`} />
            <span>API Settings</span>
            {settings.openai_api_key_set ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 ml-1"></span>
            ) : (
              <span className="w-2 h-2 rounded-full bg-yellow-400 ml-1 animate-pulse"></span>
            )}
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left/Middle 2 Columns: Main Board */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Active Campaign Status / Stepper */}
          {activeRunId && runData && (
            <div className="glass-panel p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-md font-bold uppercase tracking-wider text-gray-400">Active Campaign Process</h3>
                  <span className="text-xs text-gray-500 font-mono">Run ID: {activeRunId}</span>
                </div>
                <div>
                  {getStatusBadge(runData.status)}
                </div>
              </div>

              {/* Stepper Component */}
              <div className="stepper-container">
                <div className="stepper-line"></div>
                <div className="stepper-line-active" style={{ 
                  width: runData.status === 'completed' ? '100%' : 
                         runData.status === 'generating_emails' ? '75%' :
                         runData.status === 'waiting_for_human' ? '50%' : '25%' 
                }}></div>

                <div className={`stepper-step completed`}>
                  <div className="stepper-circle"><Check className="h-4 w-4" /></div>
                  <span className="stepper-label">Loaded CSV</span>
                </div>

                <div className={`stepper-step ${getStepStatus('score')}`}>
                  <div className="stepper-circle">
                    {getStepStatus('score') === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : 
                     getStepStatus('score') === 'completed' ? <Check className="h-4 w-4" /> : '2'}
                  </div>
                  <span className="stepper-label">Scoring Leads</span>
                </div>

                <div className={`stepper-step ${getStepStatus('human')}`}>
                  <div className="stepper-circle">
                    {getStepStatus('human') === 'active' ? <User className="h-4 w-4 text-purple-400 animate-pulse" /> : 
                     getStepStatus('human') === 'completed' ? <Check className="h-4 w-4" /> : '3'}
                  </div>
                  <span className="stepper-label">Human Review</span>
                </div>

                <div className={`stepper-step ${getStepStatus('emails')}`}>
                  <div className="stepper-circle">
                    {getStepStatus('emails') === 'active' ? <Loader2 className="h-4 w-4 animate-spin" /> : 
                     getStepStatus('emails') === 'completed' ? <Mail className="h-4 w-4" /> : '4'}
                  </div>
                  <span className="stepper-label">Email Drafts</span>
                </div>
              </div>

              {/* Flow Execution Warnings/Errors */}
              {runData.status === 'failed' && (
                <div className="mt-4 p-4 bg-red-950/30 border border-red-800/50 rounded-xl flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-red-300">Campaign Execution Error</h4>
                    <p className="text-xs text-red-400 mt-1">{runData.error}</p>
                    <button 
                      onClick={resetFlow}
                      className="mt-3 flex items-center space-x-1.5 px-3 py-1.5 bg-red-900/50 hover:bg-red-800/50 border border-red-700/50 rounded-lg text-xs font-semibold transition"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Dashboard</span>
                    </button>
                  </div>
                </div>
              )}

              {runData.status === 'quit' && (
                <div className="mt-4 p-4 bg-orange-950/30 border border-orange-800/50 rounded-xl flex items-start space-x-3">
                  <AlertCircle className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-bold text-orange-300">Campaign Stopped</h4>
                    <p className="text-xs text-orange-400 mt-1">Workflow was quit during human evaluation review.</p>
                    <button 
                      onClick={resetFlow}
                      className="mt-3 flex items-center space-x-1.5 px-3 py-1.5 bg-orange-900/50 hover:bg-orange-800/50 border border-orange-700/50 rounded-lg text-xs font-semibold transition"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Start New Run</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Human-in-the-Loop review panel */}
          {activeRunId && runData && runData.status === 'waiting_for_human' && (
            <div className="glass-panel p-6 border-l-4 border-l-purple-500 bg-purple-950/10">
              <div className="flex items-center space-x-2 mb-4">
                <Award className="h-5 w-5 text-purple-400" />
                <h2 className="text-lg font-bold text-white">Human Review: Top Evaluated Leads</h2>
              </div>
              <p className="text-sm text-gray-300 mb-6">
                The crew has identified the top 3 candidates matching the job description. Please review their scores and reasons, and decide whether to approve or re-run the evaluation.
              </p>

              {/* Top Candidates Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {runData.top_candidates?.map((candidate, idx) => (
                  <div key={candidate.id} className="bg-gray-900/90 rounded-xl p-4 border border-purple-500/20 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs text-gray-500 font-mono">#{idx+1} Match</span>
                        <span className="bg-indigo-900/50 text-indigo-300 text-xs font-extrabold px-2 py-0.5 rounded border border-indigo-700/30">
                          Score: {candidate.score}/100
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-white mb-1">{candidate.name}</h4>
                      <p className="text-xs text-gray-400 line-clamp-4 mt-2 mb-4">{candidate.reason}</p>
                    </div>
                    <div className="text-[11px] text-gray-500 border-t border-gray-800 pt-2 font-mono">
                      ID: {candidate.id}
                    </div>
                  </div>
                ))}
              </div>

              {/* Selection actions */}
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">
                    Evaluation feedback (Needed if re-evaluating)
                  </label>
                  <textarea 
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Provide instructions to adjust the crew evaluation (e.g. 'Prioritize React experience', 'Double check candidates with less than 2 years bio')"
                    className="w-full h-20 px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-sm focus:outline-none focus:border-purple-500 transition"
                  />
                </div>

                <div className="flex flex-wrap gap-4 pt-2">
                  <button 
                    disabled={actionLoading}
                    onClick={() => submitChoice('3')}
                    className="flex-1 min-w-[200px] glow-btn-primary py-3 rounded-xl flex items-center justify-center space-x-2 text-sm"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    <span>Approve & Write Emails</span>
                  </button>

                  <button 
                    disabled={actionLoading || !feedback.trim()}
                    onClick={() => submitChoice('2')}
                    className="px-6 py-3 rounded-xl bg-purple-900/40 hover:bg-purple-800/40 border border-purple-700 text-purple-200 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>Re-evaluate with Feedback</span>
                  </button>

                  <button 
                    disabled={actionLoading}
                    onClick={() => submitChoice('1')}
                    className="px-6 py-3 rounded-xl bg-gray-900 hover:bg-gray-800 border border-gray-800 text-red-400 text-sm font-semibold transition flex items-center justify-center space-x-2"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Quit Flow</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Email generation outputs */}
          {activeRunId && runData && runData.status === 'completed' && (
            <div className="glass-panel p-6 border-l-4 border-l-emerald-500 bg-emerald-950/10">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center space-x-2">
                  <Mail className="h-5 w-5 text-emerald-400" />
                  <h2 className="text-lg font-bold text-white">Generated Follow-up Emails</h2>
                </div>
                <button 
                  onClick={resetFlow}
                  className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-900/40 hover:bg-emerald-800/40 border border-emerald-700/50 rounded-xl text-xs font-semibold text-emerald-200 transition"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>New Campaign</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1 border-r border-gray-800/80 pr-4 space-y-2">
                  <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Leads Generated</span>
                  {Object.keys(runData.emails || {}).map((name) => (
                    <button
                      key={name}
                      onClick={() => setSelectedCandidateEmail(name)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition flex justify-between items-center ${
                        selectedCandidateEmail === name ? 'bg-indigo-600/80 text-white' : 'bg-gray-900/60 hover:bg-gray-800/60 text-gray-300'
                      }`}
                    >
                      <span className="truncate">{name}</span>
                      <ChevronRight className="h-4 w-4 opacity-50" />
                    </button>
                  ))}
                  {Object.keys(runData.emails || {}).length === 0 && (
                    <p className="text-xs text-gray-500 italic p-2">No emails were generated.</p>
                  )}
                </div>

                <div className="md:col-span-2 pl-2">
                  {selectedCandidateEmail ? (
                    <div className="bg-gray-950 rounded-xl border border-gray-800 p-4 relative">
                      <div className="flex justify-between items-center border-b border-gray-800 pb-3 mb-4">
                        <div>
                          <span className="text-xs text-gray-500">Outreach draft for</span>
                          <h4 className="text-sm font-bold text-white">{selectedCandidateEmail}</h4>
                        </div>
                        <button 
                          onClick={() => copyToClipboard(runData.emails[selectedCandidateEmail], selectedCandidateEmail)}
                          className="p-2 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-400 hover:text-white transition flex items-center space-x-1"
                          title="Copy email body"
                        >
                          {copiedCandidate === selectedCandidateEmail ? (
                            <>
                              <Check className="h-4 w-4 text-emerald-400" />
                              <span className="text-xs text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              <span className="text-xs">Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[300px]">
                        {runData.emails[selectedCandidateEmail]}
                      </pre>
                    </div>
                  ) : (
                    <div className="h-full min-h-[200px] border border-dashed border-gray-800 rounded-xl flex flex-col justify-center items-center text-gray-500 text-sm">
                      <FileText className="h-8 w-8 mb-2 opacity-30" />
                      <span>Select a candidate on the left to preview outreach email</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Lead scoring results (Candidates evaluated) */}
          <div className="glass-panel p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-bold text-white">Candidates & Evaluated Lead Scores</h2>
              {!activeRunId && (
                <button
                  id="start-campaign-btn"
                  onClick={startCampaign}
                  disabled={actionLoading}
                  className="px-5 py-2.5 rounded-xl glow-btn-primary flex items-center space-x-2 text-sm"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                  <span>Start Campaign Run</span>
                </button>
              )}
            </div>

            {/* List candidate table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-xs table-header uppercase">
                    <th className="pb-3 font-semibold">Candidate</th>
                    <th className="pb-3 font-semibold">Skills</th>
                    <th className="pb-3 font-semibold text-center">AI Score</th>
                    <th className="pb-3 font-semibold">Match Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {/* If we have candidate scores from active run, use them, otherwise use loaded csv leads */}
                  {runData?.scored_candidates ? (
                    runData.scored_candidates.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-900/30 transition text-sm">
                        <td className="py-4 pr-3">
                          <div className="font-bold text-white">{c.name}</div>
                          <div className="text-xs text-gray-500 font-mono mt-0.5">{c.email}</div>
                        </td>
                        <td className="py-4 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {c.skills?.split(',').map((skill, i) => (
                              <span key={i} className="text-[10px] bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/30 text-gray-300">
                                {skill.trim()}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-4 text-center pr-3">
                          <span className={`inline-block font-extrabold px-2.5 py-1 rounded text-xs ${
                            c.score >= 80 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50' :
                            c.score >= 50 ? 'bg-indigo-950 text-indigo-400 border border-indigo-800/50' :
                            'bg-gray-800 text-gray-400'
                          }`}>
                            {c.score}/100
                          </span>
                        </td>
                        <td className="py-4 text-xs text-gray-400 max-w-[250px] truncate" title={c.reason}>
                          {c.reason || 'No review reason.'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    leads.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-900/30 transition text-sm">
                        <td className="py-4 pr-3">
                          <div className="font-bold text-white">{c.name}</div>
                          <div className="text-xs text-gray-500 font-mono mt-0.5">{c.email}</div>
                        </td>
                        <td className="py-4 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {c.skills?.split(',').map((skill, i) => (
                              <span key={i} className="text-[10px] bg-gray-800/80 px-2 py-0.5 rounded border border-gray-700/30 text-gray-300">
                                {skill.trim()}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-4 text-center pr-3">
                          <span className="text-xs text-gray-500 font-mono">Unevaluated</span>
                        </td>
                        <td className="py-4 text-xs text-gray-500 italic max-w-[250px] truncate">
                          Run the campaign to score this lead.
                        </td>
                      </tr>
                    ))
                  )}

                  {leads.length === 0 && !runData && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-sm text-gray-500 italic">
                        {loading ? (
                          <div className="flex items-center justify-center space-x-2">
                            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                            <span>Loading candidates from CSV...</span>
                          </div>
                        ) : 'No candidate leads found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 1 Column: Logs panel & Instructions */}
        <div className="lg:col-span-1 space-y-8">
          
          {/* Logs panel */}
          <div className="glass-panel p-6 flex flex-col h-[400px]">
            <div className="flex items-center space-x-2 border-b border-gray-800 pb-3 mb-4 shrink-0">
              <Terminal className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Crew Console Logs</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto bg-gray-950/80 rounded-xl border border-gray-900 p-3 font-mono text-[11px] text-gray-400 space-y-2.5">
              {runData?.logs && runData.logs.length > 0 ? (
                runData.logs.map((log, i) => (
                  <div key={i} className="leading-relaxed border-l-2 border-indigo-500/25 pl-2">
                    <span className="text-gray-600 font-sans mr-1">[{new Date().toLocaleTimeString()}]</span>
                    <span>{log}</span>
                  </div>
                ))
              ) : (
                <div className="h-full flex items-center justify-center text-gray-600 text-center italic leading-relaxed">
                  No active logs. Click "Start Campaign Run" to spin up the agents.
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Job description reference card */}
          <div className="glass-panel p-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider border-b border-gray-800 pb-3 mb-4">
              Evaluation Target Job
            </h3>
            <div className="space-y-4 text-xs leading-relaxed text-gray-300">
              <div>
                <span className="block text-gray-500 font-semibold uppercase tracking-wider mb-1">Target Position</span>
                <span className="text-sm font-bold text-indigo-300">Senior React & Python AI Engineer</span>
              </div>
              <div>
                <span className="block text-gray-500 font-semibold uppercase tracking-wider mb-1">Role Description</span>
                <p>
                  Design interactive interfaces and connect backend systems with advanced Agentic AI workflows. Work with CrewAI, LangChain, React, FastAPI, and Vite.
                </p>
              </div>
              <div>
                <span className="block text-gray-500 font-semibold uppercase tracking-wider mb-1">Key Requirements</span>
                <ul className="list-disc pl-4 space-y-1 mt-1 text-gray-400">
                  <li>Strong TypeScript/JavaScript & React experience</li>
                  <li>Proficiency in Python (FastAPI/Django)</li>
                  <li>Knowledge of AI agent frameworks & architectures</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Settings Modal (API Keys) */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="glass-panel max-w-md w-full p-6 bg-gray-900 border border-gray-700/60 shadow-2xl">
            <div className="flex justify-between items-start border-b border-gray-800 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">API Keys Configuration</h3>
                <p className="text-xs text-gray-400 mt-1">Configure your API credentials to run the CrewAI agents.</p>
              </div>
            </div>

            <form onSubmit={saveSettings} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                  OpenAI API Key <span className="text-red-400">*</span>
                </label>
                <input 
                  type="password"
                  required
                  placeholder={settings.openai_api_key_set ? "••••••••••••••••••••••••" : "sk-..."}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-850 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition text-white"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Keys are stored in memory for the duration of the server process.</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1.5">
                  Serper API Key <span className="text-gray-500">(Optional)</span>
                </label>
                <input 
                  type="password"
                  placeholder={settings.serper_api_key_set ? "••••••••••••••••••••••••" : "Enter Serper key..."}
                  value={serperKeyInput}
                  onChange={(e) => setSerperKeyInput(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-850 rounded-xl text-sm focus:outline-none focus:border-indigo-500 transition text-white"
                />
              </div>

              <div className="flex space-x-3 pt-3 border-t border-gray-800">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 py-2.5 rounded-xl glow-btn-primary text-sm font-semibold flex items-center justify-center space-x-2"
                >
                  {actionLoading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : null}
                  <span>Save Configuration</span>
                </button>
                
                {settings.openai_api_key_set && (
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="px-4 py-2.5 bg-gray-850 hover:bg-gray-800 border border-gray-700/50 rounded-xl text-sm font-semibold text-gray-300 transition"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
