import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  RotateCcw, 
  Database, 
  Terminal, 
  GitMerge, 
  Bell, 
  User, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  PhoneCall, 
  Calendar, 
  HelpCircle,
  Clock,
  Sparkles,
  Smartphone,
  Sliders,
  Settings,
  Plus,
  Trash2,
  Zap,
  Shuffle,
  Award,
  Check,
  Eye
} from 'lucide-react';

// API base URL: empty for same-origin (vercel dev), or set VITE_API_URL for cross-origin
const API_BASE = import.meta.env.VITE_API_URL || '';

export default function App() {
  const [phone, setPhone] = useState('+919876543210');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  
  // Dashboard states
  const [contacts, setContacts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [sessions, setSessions] = useState({});
  const [activeTab, setActiveTab] = useState('crm');
  const [expandedPayloadId, setExpandedPayloadId] = useState(null);

  // Control Panel States
  const [activeSubTab, setActiveSubTab] = useState('journey');
  const [journeyNodes, setJourneyNodes] = useState({});
  const [selectedNodeId, setSelectedNodeId] = useState('WELCOME');
  const [gameLevels, setGameLevels] = useState([]);
  const [segments, setSegments] = useState([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isConfettiActive, setIsConfettiActive] = useState(false);

  const chatEndRef = useRef(null);

  // Active Session state computed from phone number
  const activeSession = sessions[phone] || {
    state: 'WELCOME',
    score: 0,
    currentLevel: 1,
    name: null,
    grade: null,
    city: null,
    parentPhone: null,
    demoBooked: false,
    answers: {}
  };

  // Sync scroll on chat messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Fetch dashboard data (replaces SSE — serverless doesn't support long-lived connections)
  const fetchDashboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/simulate`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data.contacts || []);
        setLogs(data.logs || []);
        setSessions(data.sessions || {});
      }
    } catch (err) {
      console.debug('Dashboard fetch error (expected on first load):', err.message);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch journey config on mount
  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      const jRes = await fetch(`${API_BASE}/api/journeys/default`);
      if (jRes.ok) {
        const jData = await jRes.json();
        if (jData && jData.definition) {
          const def = typeof jData.definition === 'string' ? JSON.parse(jData.definition) : jData.definition;
          
          // Auto-initialize coordinates for the flowchart canvas
          const nodes = def.nodes || {};
          let index = 0;
          Object.keys(nodes).forEach(id => {
            if (nodes[id].x === undefined) {
              nodes[id].x = 50 + (index % 3) * 260;
              nodes[id].y = 50 + Math.floor(index / 3) * 190;
            }
            index++;
          });
          setJourneyNodes(nodes);
        }
      }
    } catch (err) {
      console.debug('Config fetch skipped (journey may not be in DB yet):', err.message);
    }
  };

  const deployJourney = async () => {
    setIsDeploying(true);
    try {
      const res = await fetch(`${API_BASE}/api/journeys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'default',
          name: 'Default Onboarding',
          is_active: true,
          definition: JSON.stringify({
            journey_id: 'default',
            entry_point: 'WELCOME',
            nodes: journeyNodes
          })
        })
      });
      if (res.ok) {
        setIsConfettiActive(true);
        setTimeout(() => setIsConfettiActive(false), 5000);
        alert("🚀 Visual Journey deployed to serverless backend!");
      }
    } catch (err) {
      alert("Error deploying journey: " + err.message);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleNodeMouseDown = (e, nodeId) => {
    if (e.button !== 0 || e.target.closest('button') || e.target.closest('input')) return;
    setDraggedNodeId(nodeId);
    const rect = e.currentTarget.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleCanvasMouseMove = (e) => {
    if (!draggedNodeId) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - dragOffset.x;
    const y = e.clientY - rect.top - dragOffset.y;
    
    const snapX = Math.round(x / 10) * 10;
    const snapY = Math.round(y / 10) * 10;
    
    setJourneyNodes(prev => ({
      ...prev,
      [draggedNodeId]: {
        ...prev[draggedNodeId],
        x: Math.max(0, snapX),
        y: Math.max(0, snapY)
      }
    }));
  };

  const handleCanvasMouseUp = () => {
    setDraggedNodeId(null);
  };

  const renderSVGConnections = () => {
    const paths = [];
    const nodeWidth = 220;
    
    Object.keys(journeyNodes).forEach(sourceId => {
      const source = journeyNodes[sourceId];
      if (!source.transitions) return;
      
      const targets = [];
      if (Array.isArray(source.transitions)) {
        source.transitions.forEach(t => {
          if (t.next_node) targets.push({ name: t.value || 'next', id: t.next_node });
        });
      } else if (typeof source.transitions === 'object') {
        Object.keys(source.transitions).forEach(trigger => {
          const targetId = source.transitions[trigger];
          if (targetId) targets.push({ name: trigger, id: targetId });
        });
      }
      
      targets.forEach(target => {
        const dest = journeyNodes[target.id];
        if (dest && dest.x !== undefined && dest.y !== undefined) {
          const x1 = source.x + nodeWidth / 2;
          const y1 = source.y + 80;
          
          const x2 = dest.x + nodeWidth / 2;
          const y2 = dest.y;
          
          const controlY = y1 + (y2 - y1) / 2;
          const pathD = `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${y2}`;
          
          paths.push(
            <g key={`${sourceId}-${target.id}-${target.name}`}>
              <path 
                d={pathD} 
                stroke="rgba(99, 102, 241, 0.4)" 
                strokeWidth="2.5" 
                fill="none" 
                markerEnd="url(#arrow)" 
                style={{ transition: 'all 0.1s' }}
              />
              <rect 
                x={(x1 + x2) / 2 - 40} 
                y={(y1 + y2) / 2 - 8} 
                width="80" 
                height="16" 
                rx="4" 
                fill="#111827" 
                stroke="rgba(255,255,255,0.06)" 
                strokeWidth="1"
              />
              <text 
                x={(x1 + x2) / 2} 
                y={(y1 + y2) / 2 + 4} 
                fill="rgba(255, 255, 255, 0.6)" 
                fontSize="8px" 
                textAnchor="middle"
                fontWeight="500"
              >
                {target.name.length > 15 ? target.name.substring(0, 12) + '...' : target.name}
              </text>
            </g>
          );
        }
      });
    });
    return paths;
  };

  const getNodeIcon = (type) => {
    switch (type) {
      case 'message': return <Send size={14} className="text-primary" />;
      case 'game_evaluator': return <Award size={14} className="text-warning" />;
      case 'input_capture': return <User size={14} className="text-success" />;
      case 'condition': return <GitMerge size={14} className="text-error" />;
      case 'ab_split': return <Shuffle size={14} style={{ color: '#06b6d4' }} />;
      case 'meta_template': return <Zap size={14} style={{ color: '#ec4899' }} />;
      default: return <HelpCircle size={14} />;
    }
  };

  const getCoachAlert = (nodeId, node) => {
    if (node.type === 'message' && (!node.responses?.[0]?.buttons || node.responses[0].buttons.length === 0)) {
      return "💡 Add a quick reply button to boost conversion by 25%";
    }
    if (nodeId === 'PITCH_AND_CTA') {
      return "💡 Add a countdown reward to this offer to reduce drop-off by 18%";
    }
    return null;
  };

  const handleAddNode = () => {
    const newNodeId = prompt("Enter Unique Node ID (e.g. CUSTOM_MESSAGE):");
    if (!newNodeId) return;
    if (journeyNodes[newNodeId]) {
      alert("Node ID already exists!");
      return;
    }
    
    setJourneyNodes(prev => ({
      ...prev,
      [newNodeId]: {
        type: 'message',
        responses: [{ text: "Enter message text here...", buttons: [] }],
        transitions: {},
        x: 100,
        y: 100
      }
    }));
    setSelectedNodeId(newNodeId);
  };

  const saveGameConfig = async (levelConfig) => {
    // Game config is now embedded in quizEngine.js — no remote API needed
    console.log('Game config saved locally:', levelConfig);
    alert('Game config changes are managed in lib/quizEngine.js for the serverless backend.');
  };

  // Initialize Welcome Message on Phone load
  useEffect(() => {
    // When the phone number or session resets, fetch fresh welcome messages
    // trigger a dry run webhook if messages are empty
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome_init',
          sender: 'bot',
          text: "👋 Hey there! Welcome to *MathematicsGeek.com*!\n\nCan you solve equations faster than a calculator? Let's find out! 🧠⚡\n\nWe challenge you to a *60-Second Vedic Maths Game*. It has 5 levels, and we'll teach you a neat trick after each level. No pressure, just fun!\n\nAre you ready? 🚀",
          buttons: ["Start Challenge 🚀", "Know More 📘"],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }
  }, [phone, messages.length]);

  // Handle WhatsApp webhooks trigger
  const handleSendMessage = async (text, isBtn = false) => {
    if (!text.trim()) return;

    // 1. Add user message to conversation list locally
    const userMsg = {
      id: 'user_' + Date.now(),
      sender: 'user',
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone,
          text: text,
          isButton: isBtn
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Simulate API error:', response.status, errText);
        setIsTyping(false);
        setMessages(prev => [...prev, {
          id: `err_${Date.now()}`,
          sender: 'bot',
          text: `⚠️ Server error (${response.status}). Please check if the database and Redis are running.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }]);
        return;
      }

      const data = await response.json();

      // Add a slight simulated delay for conversational realism
      setTimeout(() => {
        setIsTyping(false);
        if (data.responses && data.responses.length > 0) {
          const botMsgs = data.responses.map((resp, idx) => ({
            id: `bot_${Date.now()}_${idx}`,
            sender: 'bot',
            text: resp.text,
            buttons: resp.buttons,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }));
          setMessages(prev => [...prev, ...botMsgs]);
        } else if (data.error) {
          setMessages(prev => [...prev, {
            id: `err_${Date.now()}`,
            sender: 'bot',
            text: `⚠️ ${data.error}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }]);
        }
        // Refresh dashboard after message
        fetchDashboard();
      }, 800);
    } catch (err) {
      console.error("Error sending message to simulate API", err);
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: `err_${Date.now()}`,
        sender: 'bot',
        text: `⚠️ Connection error: ${err.message}. Is the server running?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }
  };

  const handleReset = async () => {
    if (confirm("Reset all session states and mock CRM data?")) {
      await fetch(`${API_BASE}/api/simulate`, { method: 'DELETE' });
      setMessages([]);
      setContacts([]);
      setLogs([]);
      setSessions({});
    }
  };

  const triggerCalendlyBooking = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'book-demo', phone })
      });
      const data = await res.json();
      if (data.success) {
        alert("📆 Mock Calendly booking event fired successfully! Check CRM and Chat updates.");
        fetchDashboard();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerFollowup = async (day) => {
    try {
      const res = await fetch(`${API_BASE}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger-followup', phone, day })
      });
      const data = await res.json();
      if (data.success && data.responses) {
        const followupMsgs = data.responses.map((resp, idx) => ({
          id: `followup_${Date.now()}_${idx}`,
          sender: 'bot',
          text: resp.text,
          buttons: resp.buttons,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
        setMessages(prev => [...prev, ...followupMsgs]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getStageBadge = (stage) => {
    switch (stage) {
      case 'New': return <span className="badge badge-new">New Lead</span>;
      case 'Engaged': return <span className="badge badge-engaged">Engaged</span>;
      case 'Qualified': return <span className="badge badge-qualified">Qualified</span>;
      case 'Demo Booked': return <span className="badge badge-demo">Demo Booked</span>;
      default: return <span className="badge">{stage}</span>;
    }
  };

  // Helper to render markdown bold in message bubbles
  const renderMessageText = (text) => {
    if (!text) return "";
    return text.split('\n').map((line, idx) => {
      // Replace *bold* with <strong>
      let formatted = line.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
      // Replace _italic_ with <em>
      formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
      return (
        <span key={idx} style={{ display: 'block', minHeight: '1.2em' }} dangerouslySetInnerHTML={{ __html: formatted }} />
      );
    });
  };

  // State tree active highlights
  const isNodeActive = (nodeState) => {
    if (activeSession.state === nodeState) return true;
    if (nodeState === 'GAME_LEVELS' && activeSession.state === 'GAME_LEVELS') return true;
    return false;
  };

  return (
    <div className="app-container">
      <div className="glow-blob glow-blob-1"></div>
      <div className="glow-blob glow-blob-2"></div>

      {/* Header */}
      <header className="header">
        <div className="brand">
          <div className="brand-logo">MG</div>
          <div className="brand-title">
            <h1>MathematicsGeek.com</h1>
            <p>Vedic Mathematics Funnel Simulator & Developer Console</p>
          </div>
        </div>
        <div className="system-status">
          <div className="status-indicator">
            <span className="pulse-dot"></span>
            Simulator Engine Active
          </div>
          <button className="btn-reset" onClick={handleReset} title="Reset simulation data">
            <RotateCcw size={14} />
            Reset Data
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        
        {/* LEFT COLUMN: WhatsApp Phone Mockup */}
        <div className="phone-wrapper">
          <div className="phone-container">
            <div className="phone-notch"></div>
            
            {/* Phone Status Bar */}
            <div className="phone-status-bar">
              <span>9:41</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <Smartphone size={10} />
                <span>5G</span>
                <span>100%</span>
              </div>
            </div>

            {/* WhatsApp Header */}
            <div className="wa-header">
              <div className="wa-avatar">🧙</div>
              <div className="wa-user-info">
                <div className="wa-user-name">MathematicsGeek Vedic Bot</div>
                <div className="wa-user-status">
                  {isTyping ? 'typing...' : 'online'}
                </div>
              </div>
            </div>

            {/* Chat Body */}
            <div className="wa-chat-body">
              {messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`message-bubble ${msg.sender === 'user' ? 'message-out' : 'message-in'}`}
                >
                  {renderMessageText(msg.text)}
                  
                  {/* WhatsApp Interactive Buttons */}
                  {msg.buttons && msg.buttons.length > 0 && (
                    <div className="wa-interactive-buttons">
                      {msg.buttons.map((btn, bIdx) => (
                        <button 
                          key={bIdx} 
                          className="wa-btn"
                          onClick={() => handleSendMessage(btn, true)}
                        >
                          {btn}
                        </button>
                      ))}
                    </div>
                  )}
                  <span className="msg-timestamp">{msg.timestamp}</span>
                </div>
              ))}

              {isTyping && (
                <div className="message-bubble message-in typing-bubble">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input Bar */}
            <div className="wa-input-bar">
              <input 
                type="text" 
                className="wa-input" 
                placeholder="Type a message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(inputText)}
              />
              <button 
                className="wa-btn-send"
                onClick={() => handleSendMessage(inputText)}
                disabled={!inputText.trim()}
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Developers & CRM dashboard */}
        <div className="right-panels">
          
          {/* Top Panel: CRM & Sync Status */}
          <div className="panel-card" style={{ flex: '1' }}>
            <div className="panel-header">
              <h2 className="panel-title">
                <Database size={18} />
                Real-Time CRM Dashboard (HubSpot Simulation)
              </h2>
              <div className="var-chip">
                <span>Leads Captured:</span>
                <span className="var-value">{contacts.length}</span>
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '250px' }}>
              {contacts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: varColor('--text-secondary') }}>
                  <AlertTriangle size={24} style={{ color: 'var(--warning)', marginBottom: '0.5rem' }} />
                  <p>No contacts registered in CRM yet. Start playing the game on the WhatsApp phone mockup!</p>
                </div>
              ) : (
                <table className="crm-contacts-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>WhatsApp No.</th>
                      <th>Grade Segment</th>
                      <th>City</th>
                      <th>Game Score</th>
                      <th>Lead Stage</th>
                      <th>Lead Score</th>
                      <th>Level/XP</th>
                      <th>Streak</th>
                      <th>Energy</th>
                      <th>Behavioral attributes</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((contact) => (
                      <tr key={contact.whatsapp_number} style={{
                        background: contact.whatsapp_number === phone ? 'rgba(99, 102, 241, 0.05)' : ''
                      }}>
                        <td><strong>{contact.name}</strong></td>
                        <td>{contact.whatsapp_number}</td>
                        <td>{contact.grade}</td>
                        <td>{contact.city}</td>
                        <td style={{ textAlign: 'center' }}><strong>{contact.score}/5</strong></td>
                        <td>{getStageBadge(contact.lead_stage)}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <div style={{ width: '40px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, contact.lead_score)}%`, height: '100%', background: 'var(--primary)' }}></div>
                            </div>
                            <span>{contact.lead_score}</span>
                          </div>
                        </td>
                        <td>Level {contact.level || 1} ({contact.xp || 0} XP)</td>
                        <td>{contact.streak || 0} 🔥</td>
                        <td>{contact.energy !== undefined && contact.energy !== null ? contact.energy : 5}/5 ⚡</td>
                        <td>
                          {contact.derived_attributes ? (() => {
                            try {
                              const derived = JSON.parse(contact.derived_attributes);
                              return (
                                <div style={{ fontSize: '0.65rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span>Speed: <strong>{derived.fast_learner_score}</strong></span>
                                  <span>Churn: <span style={{ color: derived.churn_risk === 'HIGH' ? 'var(--warning)' : 'var(--success)' }}>{derived.churn_risk}</span></span>
                                  <span>Pref: <strong>{derived.difficulty_preference}</strong></span>
                                </div>
                              );
                            } catch (e) {
                              return <span style={{ color: 'var(--text-muted)' }}>-</span>;
                            }
                          })() : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                        </td>
                        <td>{contact.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Tabbed Control Section (Logs, Decision Flow, Trigger Panel) */}
          <div className="panel-card" style={{ flex: '1.5' }}>
            <div className="tab-buttons">
              <button 
                className={`tab-btn ${activeTab === 'crm' ? 'tab-btn-active' : ''}`}
                onClick={() => setActiveTab('crm')}
              >
                <Terminal size={14} style={{ marginRight: '4px', display: 'inline' }} />
                API & Webhook Logs
              </button>
              <button 
                className={`tab-btn ${activeTab === 'flow' ? 'tab-btn-active' : ''}`}
                onClick={() => setActiveTab('flow')}
              >
                <GitMerge size={14} style={{ marginRight: '4px', display: 'inline' }} />
                Active Conversational Node
              </button>
              <button 
                className={`tab-btn ${activeTab === 'controls' ? 'tab-btn-active' : ''}`}
                onClick={() => setActiveTab('controls')}
              >
                <Clock size={14} style={{ marginRight: '4px', display: 'inline' }} />
                Automation & Drop-off Controls
              </button>
              <button 
                className={`tab-btn ${activeTab === 'control_panel' ? 'tab-btn-active' : ''}`}
                onClick={() => setActiveTab('control_panel')}
              >
                <Settings size={14} style={{ marginRight: '4px', display: 'inline' }} />
                Growth Control Panel
              </button>
            </div>

            {/* TAB CONTENT 1: Logs */}
            {activeTab === 'crm' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Live Webhook Event Payload Pipeline (HubSpot / Make.com Webhooks, Slack Alerts)
                  </p>
                  <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>SSE Connection Est.</span>
                </div>
                
                <div className="logs-console">
                  {logs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '1rem' }}>
                      Waiting for webhook transmissions... Send messages in phone simulation.
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div key={log.id} className={`log-row log-row-${log.category.toLowerCase()}`}>
                        <div className="log-meta">
                          <span className="log-category-badge">{log.category}</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                          <span className="log-title">{log.title}</span>
                          {Object.keys(log.payload).length > 0 && (
                            <button 
                              className="log-json-toggle"
                              onClick={() => setExpandedPayloadId(expandedPayloadId === log.id ? null : log.id)}
                            >
                              {expandedPayloadId === log.id ? '[-]' : '[+] View Payload JSON'}
                            </button>
                          )}
                        </div>
                        <div className="log-desc">{log.description}</div>
                        {expandedPayloadId === log.id && (
                          <pre className="log-payload-box">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: Active Conversational Node */}
            {activeTab === 'flow' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Visual tracking of the active state machine nodes for phone <strong>{phone}</strong>.
                  </p>
                  <div className="var-chip" style={{ margin: 0 }}>
                    <span>Active state:</span>
                    <span className="var-value">{activeSession.state}</span>
                  </div>
                </div>

                <div className="flow-diagram-container">
                  <div className={`flow-node ${isNodeActive('WELCOME') ? 'flow-node-active' : ''}`}>
                    <div>
                      <div className="flow-node-title">Node 1: Entry Greeting (WELCOME)</div>
                      <div className="flow-node-desc">Greet the user and offer a 60-second Vedic challenge.</div>
                    </div>
                    {isNodeActive('WELCOME') && <Sparkles size={16} style={{ color: 'var(--primary)' }} />}
                  </div>

                  <div className={`flow-node ${isNodeActive('INFO') ? 'flow-node-active' : ''}`}>
                    <div>
                      <div className="flow-node-title">Node 1.1: Brand Info (INFO)</div>
                      <div className="flow-node-desc">Explain Vedic Math details, social proof, direct play trigger.</div>
                    </div>
                    {isNodeActive('INFO') && <Sparkles size={16} style={{ color: 'var(--primary)' }} />}
                  </div>

                  <div className={`flow-node ${isNodeActive('GAME_LEVELS') ? 'flow-node-active' : ''}`}>
                    <div>
                      <div className="flow-node-title">Node 2.x: Vedic Maths Challenge (GAME_LEVELS)</div>
                      <div className="flow-node-desc">5 levels of shortcuts. Tracks correct score and presents wow tricks.</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="var-chip">Lv: <span className="var-value">{activeSession.currentLevel}/5</span></span>
                      <span className="var-chip">Score: <span className="var-value">{activeSession.score}</span></span>
                      {isNodeActive('GAME_LEVELS') && <Sparkles size={16} style={{ color: 'var(--primary)' }} />}
                    </div>
                  </div>

                  <div className={`flow-node ${isNodeActive('SCORE_SUMMARY') ? 'flow-node-active' : ''}`}>
                    <div>
                      <div className="flow-node-title">Node 3: Results Summary (SCORE_SUMMARY)</div>
                      <div className="flow-node-desc">Displays score percentile rank and triggers curiosity for advanced tricks.</div>
                    </div>
                    {isNodeActive('SCORE_SUMMARY') && <Sparkles size={16} style={{ color: 'var(--primary)' }} />}
                  </div>

                  <div className={`flow-node ${
                    ['CAPTURE_NAME', 'CAPTURE_GRADE', 'CAPTURE_CITY', 'CAPTURE_PHONE'].includes(activeSession.state) ? 'flow-node-active' : ''
                  }`}>
                    <div>
                      <div className="flow-node-title">Node 4.x: Progressive Profiling (LEAD_CAPTURE)</div>
                      <div className="flow-node-desc">Sequentially collect Name, Grade Segment, City, and parent's phone.</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {activeSession.name && <span className="var-chip" style={{ fontSize: '0.6rem' }}>Name</span>}
                      {activeSession.grade && <span className="var-chip" style={{ fontSize: '0.6rem' }}>Grade</span>}
                      {activeSession.parentPhone && <span className="var-chip" style={{ fontSize: '0.6rem' }}>Phone</span>}
                      {['CAPTURE_NAME', 'CAPTURE_GRADE', 'CAPTURE_CITY', 'CAPTURE_PHONE'].includes(activeSession.state) && <Sparkles size={16} style={{ color: 'var(--primary)' }} />}
                    </div>
                  </div>

                  <div className={`flow-node ${isNodeActive('PITCH_AND_CTA') ? 'flow-node-active' : ''}`}>
                    <div>
                      <div className="flow-node-title">Node 5.x: Dynamic Pitch & CTA (PITCH_AND_CTA)</div>
                      <div className="flow-node-desc">Present grade-specific pitch benefits and call-to-actions to book slots.</div>
                    </div>
                    {isNodeActive('PITCH_AND_CTA') && <Sparkles size={16} style={{ color: 'var(--primary)' }} />}
                  </div>

                  <div className={`flow-node ${isNodeActive('COMPLETED') ? 'flow-node-active' : ''}`}>
                    <div>
                      <div className="flow-node-title">Node 6: Conversions (DEMO_BOOKED)</div>
                      <div className="flow-node-desc">User scheduled Calendly demo. Cancel all drop-off automation campaigns.</div>
                    </div>
                    {isNodeActive('COMPLETED') && <Sparkles size={16} style={{ color: 'var(--success)' }} />}
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 3: Controls and Admin */}
            {activeTab === 'controls' && (
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Simulate external triggers like <strong>drop-off campaigns</strong> and <strong>Calendly booking integrations</strong>.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  
                  {/* Calendly Booking Simulation */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'white' }}>Calendly Integration Simulator</span>
                      <span className="badge badge-demo">Triggers Webhook</span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Simulates a user choosing a time slot in Calendly. Fired webhook forces the lead stage to "Demo Booked" and triggers Zoom confirmations.
                    </p>
                    <button 
                      className="btn-admin" 
                      onClick={triggerCalendlyBooking}
                      style={{ border: '1px solid var(--success)', background: 'var(--success-light)', color: 'var(--success)' }}
                    >
                      <Calendar size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-top' }} />
                      Simulate Calendly Demo Booked
                    </button>
                  </div>

                  {/* Drop-off Campaigns */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'white' }}>Automated Drop-off Nudges</span>
                      <span className="badge badge-engaged">3-Day Campaigns</span>
                    </div>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Manually fire value/proof triggers if the user drops off midway. Nudges load templates to capture lead attention.
                    </p>
                    
                    <div className="admin-actions">
                      <button className="btn-admin" onClick={() => triggerFollowup(1)}>
                        Day 1: Division Nudge
                      </button>
                      <button className="btn-admin" onClick={() => triggerFollowup(2)}>
                        Day 2: Social Proof
                      </button>
                      <button className="btn-admin" onClick={() => triggerFollowup(3)}>
                        Day 3: Urgency Spot
                      </button>
                    </div>
                  </div>

                  {/* Phone testing switch */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Testing phone:</span>
                    <input 
                      type="text" 
                      value={phone}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        setPhone(val);
                        setMessages([]); // clear current chat list to reload welcome on new phone
                      }}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', color: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', width: '130px' }}
                    />
                    <span style={{ color: 'var(--text-muted)' }}>Modify to test fresh funnel sequences.</span>
                  </div>

                </div>
              </div>
            )}

            {/* TAB CONTENT 4: Growth Control Panel */}
            {activeTab === 'control_panel' && (
              <div>
                {/* Sub tabs */}
                <div className="config-sub-tabs">
                  <button 
                    className={`config-sub-tab-btn ${activeSubTab === 'journey' ? 'config-sub-tab-btn-active' : ''}`}
                    onClick={() => setActiveSubTab('journey')}
                  >
                    Visual Journey Builder
                  </button>
                  <button 
                    className={`config-sub-tab-btn ${activeSubTab === 'game' ? 'config-sub-tab-btn-active' : ''}`}
                    onClick={() => setActiveSubTab('game')}
                  >
                    Vedic Math Config
                  </button>
                  <button 
                    className={`config-sub-tab-btn ${activeSubTab === 'segments' ? 'config-sub-tab-btn-active' : ''}`}
                    onClick={() => setActiveSubTab('segments')}
                  >
                    CDP Segmentation
                  </button>
                </div>

                {/* Sub Tab: Journey Builder */}
                {activeSubTab === 'journey' && (
                  <div>
                    {isConfettiActive && (
                      <div className="confetti-container">
                        {Array.from({ length: 60 }).map((_, i) => (
                          <div 
                            key={i} 
                            className="confetti-piece" 
                            style={{
                              left: `${Math.random() * 100}%`,
                              animationDelay: `${Math.random() * 2.5}s`,
                              backgroundColor: ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4'][i % 6]
                            }}
                          />
                        ))}
                      </div>
                    )}

                    <div className="journey-builder-workspace">
                      {/* Interactive flowchart canvas */}
                      <div 
                        className="flowchart-canvas"
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        style={{
                          flex: '2',
                          minWidth: '500px',
                          border: '1px solid var(--border-color)',
                          borderRadius: '12px',
                          background: '#0a0d16',
                          position: 'relative',
                          overflow: 'auto'
                        }}
                      >
                        {/* Canvas Header Control */}
                        <div style={{ position: 'absolute', top: '12px', left: '12px', display: 'flex', gap: '8px', zIndex: 10 }}>
                          <button 
                            className="btn-admin" 
                            onClick={handleAddNode}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                          >
                            <Plus size={14} /> Add New Node
                          </button>
                        </div>

                        {/* SVG Connections layer */}
                        <svg 
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '2000px',
                            height: '2000px',
                            pointerEvents: 'none',
                            zIndex: 1
                          }}
                        >
                          <defs>
                            <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                              <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
                            </marker>
                          </defs>
                          {renderSVGConnections()}
                        </svg>

                        {/* Node Card Loop */}
                        {Object.keys(journeyNodes).map((nodeId) => {
                          const node = journeyNodes[nodeId];
                          return (
                            <div
                              key={nodeId}
                              className={`flowchart-node-card node-card-${node.type} ${selectedNodeId === nodeId ? 'node-card-selected' : ''}`}
                              style={{
                                position: 'absolute',
                                left: `${node.x || 50}px`,
                                top: `${node.y || 50}px`,
                                zIndex: 2,
                                cursor: draggedNodeId === nodeId ? 'grabbing' : 'grab'
                              }}
                              onMouseDown={(e) => handleNodeMouseDown(e, nodeId)}
                              onClick={() => setSelectedNodeId(nodeId)}
                            >
                              <div className="node-card-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {getNodeIcon(node.type)}
                                  <span style={{ fontWeight: 'bold' }}>{nodeId}</span>
                                </div>
                                <button 
                                  className="node-delete-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete node "${nodeId}"?`)) {
                                      setJourneyNodes(prev => {
                                        const copy = { ...prev };
                                        delete copy[nodeId];
                                        return copy;
                                      });
                                      if (selectedNodeId === nodeId) setSelectedNodeId(null);
                                    }
                                  }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                              <div className="node-card-body">
                                <p className="node-preview-text">
                                  {node.text 
                                    ? (node.text.substring(0, 48) + (node.text.length > 48 ? '...' : '')) 
                                    : (node.responses?.[0]?.text 
                                      ? (node.responses[0].text.substring(0, 48) + (node.responses[0].text.length > 48 ? '...' : ''))
                                      : `[${node.type}]`
                                    )
                                  }
                                </p>
                                
                                {node.type === 'message' && node.responses?.[0]?.buttons && (
                                  <div style={{ marginTop: '4px' }}>
                                    {node.responses[0].buttons.map(b => (
                                      <span key={b} className="node-btn-badge">{b}</span>
                                    ))}
                                  </div>
                                )}
                                
                                {node.type === 'meta_template' && (
                                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                                    <span className="node-btn-badge" style={{ background: 'rgba(236,72,153,0.15)', borderColor: 'rgba(236,72,153,0.3)' }}>{node.template_name}</span>
                                    <span className="badge badge-qualified" style={{ fontSize: '0.55rem', padding: '1px 4px' }}>{node.approval_status || 'APPROVED'}</span>
                                  </div>
                                )}

                                {node.type === 'ab_split' && (
                                  <div style={{ marginTop: '4px' }}>
                                    {(node.variants || []).map(v => (
                                      <span key={v.id} className="node-btn-badge" style={{ background: 'rgba(6,182,212,0.15)', borderColor: 'rgba(6,182,212,0.3)' }}>
                                        {v.id} ({v.weight}%)
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {getCoachAlert(nodeId, node) && (
                                <div className="node-coach-badge" title={getCoachAlert(nodeId, node)}>
                                  💡
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Node Config Panel */}
                      <div className="node-editor-form" style={{ flex: '1', minWidth: '320px', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '12px', border: '1px solid var(--border-color)', height: '520px', overflowY: 'auto' }}>
                        {selectedNodeId && journeyNodes[selectedNodeId] ? (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'white' }}>Node Configurations</span>
                              <span className="badge badge-engaged" style={{ fontSize: '0.65rem' }}>{journeyNodes[selectedNodeId].type}</span>
                            </div>

                            <div className="form-group-horizontal">
                              <span className="form-label">Node ID</span>
                              <input className="form-input" value={selectedNodeId} disabled style={{ width: '100%' }} />
                            </div>

                            <div className="form-group-horizontal">
                              <span className="form-label">Node Type</span>
                              <select 
                                className="form-select"
                                value={journeyNodes[selectedNodeId].type}
                                onChange={(e) => {
                                  const type = e.target.value;
                                  setJourneyNodes(prev => {
                                    const copy = { ...prev[selectedNodeId], type };
                                    if (type === 'ab_split' && !copy.variants) {
                                      copy.variants = [
                                        { id: 'variant_a', weight: 50, next_node: '' },
                                        { id: 'variant_b', weight: 50, next_node: '' }
                                      ];
                                    }
                                    if (type === 'meta_template' && !copy.template_name) {
                                      copy.template_name = 'welcome_promo_v1';
                                      copy.language = 'en_US';
                                      copy.approval_status = 'APPROVED';
                                      copy.buttons = ["Start Challenge 🚀", "Know More 📘"];
                                    }
                                    return { ...prev, [selectedNodeId]: copy };
                                  });
                                }}
                                style={{ width: '100%' }}
                              >
                                <option value="message">Message Node</option>
                                <option value="game_evaluator">Game Node</option>
                                <option value="input_capture">Profiler Node</option>
                                <option value="condition">Condition Node</option>
                                <option value="ab_split">A/B Split Test Node</option>
                                <option value="meta_template">Meta Template Node</option>
                              </select>
                            </div>

                            {/* TYPE 1: MESSAGE */}
                            {journeyNodes[selectedNodeId].type === 'message' && (
                              <>
                                <div className="form-group-horizontal" style={{ alignItems: 'flex-start' }}>
                                  <span className="form-label">Text Body</span>
                                  <textarea 
                                    className="form-textarea" 
                                    rows={4}
                                    value={journeyNodes[selectedNodeId].responses?.[0]?.text || journeyNodes[selectedNodeId].text || ''}
                                    onChange={(e) => {
                                      const text = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.text = text;
                                        node.responses = [{ text, buttons: node.responses?.[0]?.buttons || node.buttons || [] }];
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    style={{ width: '100%', resize: 'vertical' }}
                                  />
                                </div>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Quick Replies</span>
                                  <input 
                                    className="form-input" 
                                    placeholder="Button 1, Button 2 (comma separated)"
                                    value={(journeyNodes[selectedNodeId].responses?.[0]?.buttons || journeyNodes[selectedNodeId].buttons || []).join(', ')}
                                    onChange={(e) => {
                                      const btns = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.buttons = btns;
                                        node.responses = [{ text: node.responses?.[0]?.text || node.text || '', buttons: btns }];
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                              </>
                            )}

                            {/* TYPE 2: PROFILER / INPUT CAPTURE */}
                            {journeyNodes[selectedNodeId].type === 'input_capture' && (
                              <>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Variable Name</span>
                                  <input 
                                    className="form-input" 
                                    placeholder="e.g. student_name"
                                    value={journeyNodes[selectedNodeId].variable || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], variable: val }
                                      }));
                                    }}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <div className="form-group-horizontal" style={{ alignItems: 'flex-start' }}>
                                  <span className="form-label">Prompt Text</span>
                                  <textarea 
                                    className="form-textarea" 
                                    rows={3}
                                    value={journeyNodes[selectedNodeId].text || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], text: val }
                                      }));
                                    }}
                                    style={{ width: '100%', resize: 'vertical' }}
                                  />
                                </div>
                              </>
                            )}

                            {/* TYPE 3: A/B SPLIT NODE */}
                            {journeyNodes[selectedNodeId].type === 'ab_split' && (
                              <>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Experiment</span>
                                  <input 
                                    className="form-input" 
                                    placeholder="e.g. welcome_message_test"
                                    value={journeyNodes[selectedNodeId].experiment_name || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], experiment_name: val }
                                      }));
                                    }}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                
                                <div style={{ marginTop: '0.5rem' }}>
                                  <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'white', display: 'block', marginBottom: '0.4rem' }}>Traffic Distribution</span>
                                  {(journeyNodes[selectedNodeId].variants || []).map((variant, vIdx) => (
                                    <div key={vIdx} style={{ background: 'rgba(255,255,255,0.02)', padding: '0.4rem', borderRadius: '6px', marginBottom: '0.4rem', border: '1px solid var(--border-color)' }}>
                                      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                                        <input 
                                          className="form-input" 
                                          placeholder="Variant ID" 
                                          value={variant.id || ''} 
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setJourneyNodes(prev => {
                                              const node = { ...prev[selectedNodeId] };
                                              node.variants = (node.variants || []).map((v, i) => i === vIdx ? { ...v, id: val } : v);
                                              return { ...prev, [selectedNodeId]: node };
                                            });
                                          }}
                                          style={{ flex: 1, fontSize: '0.65rem', padding: '0.2rem' }}
                                        />
                                        <input 
                                          type="number"
                                          className="form-input" 
                                          placeholder="Weight %" 
                                          value={variant.weight || 0} 
                                          onChange={(e) => {
                                            const val = parseInt(e.target.value, 10) || 0;
                                            setJourneyNodes(prev => {
                                              const node = { ...prev[selectedNodeId] };
                                              node.variants = (node.variants || []).map((v, i) => i === vIdx ? { ...v, weight: val } : v);
                                              return { ...prev, [selectedNodeId]: node };
                                            });
                                          }}
                                          style={{ width: '60px', fontSize: '0.65rem', padding: '0.2rem' }}
                                        />
                                        <button 
                                          className="btn-reset" 
                                          onClick={() => {
                                            setJourneyNodes(prev => {
                                              const node = { ...prev[selectedNodeId] };
                                              node.variants = (node.variants || []).filter((_, i) => i !== vIdx);
                                              return { ...prev, [selectedNodeId]: node };
                                            });
                                          }}
                                          style={{ padding: '0.1rem 0.3rem', height: '22px' }}
                                        >
                                          <Trash2 size={10} />
                                        </button>
                                      </div>
                                      <select 
                                        className="form-select"
                                        value={variant.next_node || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setJourneyNodes(prev => {
                                            const node = { ...prev[selectedNodeId] };
                                            node.variants = (node.variants || []).map((v, i) => i === vIdx ? { ...v, next_node: val } : v);
                                            return { ...prev, [selectedNodeId]: node };
                                          });
                                        }}
                                        style={{ width: '100%', fontSize: '0.65rem', padding: '0.2rem' }}
                                      >
                                        <option value="">Route to next node...</option>
                                        {Object.keys(journeyNodes).map(id => <option key={id} value={id}>{id}</option>)}
                                      </select>
                                    </div>
                                  ))}
                                  <button 
                                    className="btn-admin" 
                                    onClick={() => {
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.variants = [...(node.variants || []), { id: `variant_${(node.variants || []).length + 1}`, weight: 50, next_node: '' }];
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    style={{ width: '100%', fontSize: '0.65rem', padding: '0.25rem' }}
                                  >
                                    + Add Traffic Variant
                                  </button>
                                </div>
                              </>
                            )}

                            {/* TYPE 4: META TEMPLATE NODE */}
                            {journeyNodes[selectedNodeId].type === 'meta_template' && (
                              <>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Template ID</span>
                                  <input 
                                    className="form-input" 
                                    placeholder="welcome_promo_v1"
                                    value={journeyNodes[selectedNodeId].template_name || ''} 
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], template_name: val }
                                      }));
                                    }}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Language</span>
                                  <input 
                                    className="form-input" 
                                    value={journeyNodes[selectedNodeId].language || 'en_US'} 
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], language: val }
                                      }));
                                    }}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <div className="form-group-horizontal" style={{ alignItems: 'flex-start' }}>
                                  <span className="form-label">Text Preview</span>
                                  <textarea 
                                    className="form-textarea" 
                                    rows={3}
                                    value={journeyNodes[selectedNodeId].text || ''} 
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], text: val }
                                      }));
                                    }}
                                    style={{ width: '100%', resize: 'vertical' }}
                                  />
                                </div>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Meta Status</span>
                                  <select 
                                    className="form-select"
                                    value={journeyNodes[selectedNodeId].approval_status || 'APPROVED'}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setJourneyNodes(prev => ({
                                        ...prev,
                                        [selectedNodeId]: { ...prev[selectedNodeId], approval_status: val }
                                      }));
                                    }}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="APPROVED">APPROVED ✅</option>
                                    <option value="PENDING">PENDING ⏳</option>
                                    <option value="REJECTED">REJECTED ❌</option>
                                  </select>
                                </div>
                              </>
                            )}

                            {/* DYNAMIC TRANSITIONS EDITOR */}
                            {['message', 'meta_template', 'game_evaluator', 'input_capture'].includes(journeyNodes[selectedNodeId].type) && (
                              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'white', display: 'block', marginBottom: '0.4rem' }}>Transitions / Next Nodes</span>
                                
                                {/* Button quick-replies routing */}
                                {journeyNodes[selectedNodeId].type === 'message' && (journeyNodes[selectedNodeId].responses?.[0]?.buttons || journeyNodes[selectedNodeId].buttons || []).map((btn) => (
                                  <div key={btn} className="form-group-horizontal" style={{ marginBottom: '0.4rem' }}>
                                    <span className="form-label" style={{ fontSize: '0.65rem', color: 'white' }}>On "{btn}"</span>
                                    <select 
                                      className="form-select"
                                      value={
                                        journeyNodes[selectedNodeId].transitions?.[btn] || 
                                        (Array.isArray(journeyNodes[selectedNodeId].transitions) && journeyNodes[selectedNodeId].transitions.find(t => t.value === btn)?.next_node) || ''
                                      }
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        setJourneyNodes(prev => {
                                          const node = { ...prev[selectedNodeId] };
                                          
                                          if (Array.isArray(node.transitions)) {
                                            const idx = node.transitions.findIndex(t => t.value === btn);
                                            if (idx >= 0) node.transitions[idx].next_node = next;
                                            else node.transitions.push({ trigger: 'button', value: btn, next_node: next });
                                          } else {
                                            node.transitions = { ...node.transitions, [btn]: next };
                                          }
                                          return { ...prev, [selectedNodeId]: node };
                                        });
                                      }}
                                      style={{ width: '100%' }}
                                    >
                                      <option value="">Choose next node...</option>
                                      {Object.keys(journeyNodes).map(id => <option key={id} value={id}>{id}</option>)}
                                    </select>
                                  </div>
                                ))}

                                {/* Fallback route when no buttons exist or on defaults */}
                                {(!journeyNodes[selectedNodeId].responses?.[0]?.buttons?.length && !journeyNodes[selectedNodeId].buttons?.length) && (
                                  <div className="form-group-horizontal">
                                    <span className="form-label">On Default Route</span>
                                    <select 
                                      className="form-select"
                                      value={
                                        journeyNodes[selectedNodeId].transitions?.default || 
                                        (Array.isArray(journeyNodes[selectedNodeId].transitions) && journeyNodes[selectedNodeId].transitions.find(t => t.trigger === 'game_success' || t.trigger === 'input')?.next_node) || ''
                                      }
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        setJourneyNodes(prev => {
                                          const node = { ...prev[selectedNodeId] };
                                          if (Array.isArray(node.transitions)) {
                                            if (node.transitions.length > 0) node.transitions[0].next_node = next;
                                            else node.transitions = [{ trigger: 'input', next_node: next }];
                                          } else {
                                            node.transitions = { ...node.transitions, default: next };
                                          }
                                          return { ...prev, [selectedNodeId]: node };
                                        });
                                      }}
                                      style={{ width: '100%' }}
                                    >
                                      <option value="">Choose next node...</option>
                                      {Object.keys(journeyNodes).map(id => <option key={id} value={id}>{id}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* CONDITION ROUTING */}
                            {journeyNodes[selectedNodeId].type === 'condition' && (
                              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'white', display: 'block', marginBottom: '0.4rem' }}>Branch Routing</span>
                                <div className="form-group-horizontal" style={{ marginBottom: '0.4rem' }}>
                                  <span className="form-label">Condition Filter</span>
                                  <input 
                                    className="form-input" 
                                    value={journeyNodes[selectedNodeId].branches?.[0]?.condition || ''} 
                                    onChange={(e) => {
                                      const cond = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.branches = [{ condition: cond, next_node: node.branches?.[0]?.next_node || '' }];
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    placeholder="e.g. session.gameState.correctCount >= 2"
                                    style={{ width: '100%', fontSize: '0.65rem' }}
                                  />
                                </div>
                                <div className="form-group-horizontal" style={{ marginBottom: '0.4rem' }}>
                                  <span className="form-label">If Match Route</span>
                                  <select 
                                    className="form-select"
                                    value={journeyNodes[selectedNodeId].branches?.[0]?.next_node || ''}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.branches = [{ condition: node.branches?.[0]?.condition || '', next_node: next }];
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    style={{ width: '100%', fontSize: '0.65rem' }}
                                  >
                                    <option value="">Choose next node...</option>
                                    {Object.keys(journeyNodes).map(id => <option key={id} value={id}>{id}</option>)}
                                  </select>
                                </div>
                                <div className="form-group-horizontal">
                                  <span className="form-label">Else Fallback</span>
                                  <select 
                                    className="form-select"
                                    value={journeyNodes[selectedNodeId].fallback || ''}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.fallback = next;
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    style={{ width: '100%', fontSize: '0.65rem' }}
                                  >
                                    <option value="">Choose fallback node...</option>
                                    {Object.keys(journeyNodes).map(id => <option key={id} value={id}>{id}</option>)}
                                  </select>
                                </div>
                              </div>
                            )}

                            {/* GROWTH COACH TIPS PANEL */}
                            {getCoachAlert(selectedNodeId, journeyNodes[selectedNodeId]) && (
                              <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', padding: '8px', borderRadius: '8px', marginTop: '10px' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Sparkles size={12} /> Growth Coach Tip
                                </span>
                                <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                  {getCoachAlert(selectedNodeId, journeyNodes[selectedNodeId])}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                            Select a node on the canvas grid map to configure properties.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Deploy Button */}
                    <div className="deploy-section">
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Converts the drag-and-drop flowchart configuration into serverless JSON rules for WhatsApp API routes.
                      </span>
                      <button 
                        className="btn-deploy" 
                        onClick={deployJourney}
                        disabled={isDeploying}
                      >
                        {isDeploying ? 'Deploying...' : 'Deploy Journey Config 🚀'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub Tab: Game Level Config */}
                {activeSubTab === 'game' && (
                  <div>
                    <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                      {gameLevels.map((lvl) => (
                        <div key={lvl.level} className="game-level-config-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'white' }}>Level {lvl.level} Configuration</span>
                            <span className="badge badge-qualified">Active</span>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Vedic Question Category</span>
                              <input 
                                className="form-input" 
                                value={lvl.type} 
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setGameLevels(prev => prev.map(l => l.level === lvl.level ? { ...l, type: val } : l));
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Time Limit (seconds)</span>
                              <input 
                                type="number"
                                className="form-input" 
                                value={lvl.time_limit} 
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10) || 10;
                                  setGameLevels(prev => prev.map(l => l.level === lvl.level ? { ...l, time_limit: val } : l));
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Reward Score</span>
                              <input 
                                type="number"
                                className="form-input" 
                                value={lvl.reward} 
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10) || 5;
                                  setGameLevels(prev => prev.map(l => l.level === lvl.level ? { ...l, reward: val } : l));
                                }}
                              />
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                            <button 
                              className="btn-admin" 
                              style={{ width: '80px', flex: 'none', padding: '0.25rem 0.5rem', fontSize: '0.65rem' }}
                              onClick={() => saveGameConfig(lvl)}
                            >
                              Save Level
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub Tab: CDP Segmentation */}
                {activeSubTab === 'segments' && (
                  <div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'white', display: 'block', marginBottom: '0.25rem' }}>Dynamic CDP Segments</span>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                        Configure tags assigned automatically by the Segmentation microservice based on calculation statistics.
                      </p>
                      <table className="crm-contacts-table" style={{ fontSize: '0.7rem' }}>
                        <thead>
                          <tr>
                            <th>Segment Name</th>
                            <th>Rules Filter Criteria</th>
                            <th>Dynamic Action Tag</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td><strong>Math Wizards</strong></td>
                            <td>Accuracy rate = 100%, Level complete = 5, Time &lt; 6s</td>
                            <td><span className="badge badge-qualified">Assign "Math Wizard" (+10 bonus)</span></td>
                          </tr>
                          <tr>
                            <td><strong>Struggling Learners</strong></td>
                            <td>Accuracy rate &lt; 60%, Levels played &ge; 3</td>
                            <td><span className="badge badge-engaged">Assign "Struggling Learner" (Nudge flow)</span></td>
                          </tr>
                          <tr>
                            <td><strong>Speed Demons</strong></td>
                            <td>Average answer time &lt; 4.5s, Levels played &ge; 3</td>
                            <td><span className="badge badge-new">Assign "Speed Demon"</span></td>
                          </tr>
                          <tr>
                            <td><strong>High Intent Leads</strong></td>
                            <td>Lead Score &ge; 50, Stage != Demo Booked</td>
                            <td><span className="badge badge-demo">Assign "High Intent" (Sales alert)</span></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      </div>

      <footer className="footer">
        <p>© 2026 MathematicsGeek.com. Built with ⚡ by Antigravity Growth Architect Studio.</p>
      </footer>
    </div>
  );
}

// Inline CSS variable extractor helper
function varColor(variableName) {
  return typeof window !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(variableName) : '';
}
