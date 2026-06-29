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
  Settings
} from 'lucide-react';

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

  // Connect to SSE stream
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.addEventListener('init', (e) => {
      const data = JSON.parse(e.data);
      setContacts(data.contacts || []);
      setLogs(data.logs || []);
      setSessions(data.sessions || {});
    });

    eventSource.addEventListener('log', (e) => {
      const log = JSON.parse(e.data);
      setLogs(prev => [log, ...prev]);
    });

    eventSource.addEventListener('crm_update', (e) => {
      const data = JSON.parse(e.data);
      setContacts(prev => {
        const exists = prev.find(c => c.whatsapp_number === data.contact.whatsapp_number);
        if (exists) {
          return prev.map(c => c.whatsapp_number === data.contact.whatsapp_number ? data.contact : c);
        }
        return [data.contact, ...prev];
      });
    });

    eventSource.addEventListener('state_change', (e) => {
      const data = JSON.parse(e.data);
      setSessions(prev => ({
        ...prev,
        [data.phone]: data.session
      }));
    });

    eventSource.addEventListener('reset', () => {
      setContacts([]);
      setLogs([]);
      setSessions({});
      setMessages([]);
    });

    return () => {
      eventSource.close();
    };
  }, []);

  // Fetch Config Service definitions on mount
  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      const jRes = await fetch('/api/config/journeys/default');
      if (jRes.ok) {
        const jData = await jRes.json();
        if (jData && jData.definition) {
          setJourneyNodes(jData.definition.nodes || {});
        }
      }
      
      const gRes = await fetch('/api/config/games');
      if (gRes.ok) {
        const gData = await gRes.json();
        setGameLevels(gData);
      }
      
      const sRes = await fetch('/api/config/segments');
      if (sRes.ok) {
        const sData = await sRes.json();
        setSegments(sData);
      }
    } catch (err) {
      console.error("Failed to fetch configurations:", err);
    }
  };

  const deployJourney = async () => {
    setIsDeploying(true);
    try {
      const res = await fetch('/api/config/journeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'default',
          name: 'Default Onboarding',
          is_active: true,
          definition: {
            journey_id: 'default',
            entry_point: 'WELCOME',
            nodes: journeyNodes
          }
        })
      });
      if (res.ok) {
        alert("🚀 Visual Journey deployed to production microservices cluster!");
      }
    } catch (err) {
      alert("Error deploying journey: " + err.message);
    } finally {
      setIsDeploying(false);
    }
  };

  const saveGameConfig = async (levelConfig) => {
    try {
      const res = await fetch('/api/config/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(levelConfig)
      });
      if (res.ok) {
        fetchConfigs();
      }
    } catch (err) {
      console.error(err);
    }
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
      const response = await fetch('/api/whatsapp-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone,
          text: text,
          isButton: isBtn
        })
      });
      const data = await response.json();

      // Add a slight simulated delay for conversational realism
      setTimeout(() => {
        setIsTyping(false);
        if (data.success && data.responses) {
          const botMsgs = data.responses.map((resp, idx) => ({
            id: `bot_${Date.now()}_${idx}`,
            sender: 'bot',
            text: resp.text,
            buttons: resp.buttons,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }));
          setMessages(prev => [...prev, ...botMsgs]);
        }
      }, 800);
    } catch (err) {
      console.error("Error sending message to webhook", err);
      setIsTyping(false);
    }
  };

  const handleReset = async () => {
    if (confirm("Reset all session states and mock CRM data?")) {
      await fetch('/api/admin/reset', { method: 'POST' });
      setMessages([]);
    }
  };

  const triggerCalendlyBooking = async () => {
    try {
      const res = await fetch('/api/crm/book-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.success) {
        alert("📆 Mock Calendly booking event fired successfully! Check CRM and Chat updates.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerFollowup = async (day) => {
    try {
      const res = await fetch('/api/admin/trigger-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, day })
      });
      const data = await res.json();
      if (data.success) {
        // Fetch fresh welcome message and add follow up
        setMessages(prev => [
          ...prev,
          {
            id: `followup_${Date.now()}`,
            sender: 'bot',
            text: day === 1 
              ? `👋 Hey! We missed you yesterday!\nHere is a quick 2-second Vedic Trick: *Dividing by 9*.\n\nFor 23 ÷ 9:\n1. First digit *2* is the quotient.\n2. Add digits (2 + 3 = 5) -> this is the remainder.\nAnswer: *2 remainder 5*!\n\nWant to learn more shortcuts? Resume where you left off! 👇`
              : day === 2
                ? `"My daughter Aarohi used to cry during math homework. After just 3 classes of Vedic Maths, she calculates faster than me!" — Smita (Parent) 👩‍👧\n\nWatch Aarohi solve a 5-digit square root in 4 seconds: https://youtube.com/mock-video\n\nGive your child math confidence! 👇`
                : `⏰ *Last Chance!*\n\nThe free 1-on-1 Vedic Maths assessment slots are almost fully booked for this week. Only *3 spots* remain in your region.\n\nDon't miss this opportunity to triple your calculation speed! 👇`,
            buttons: day === 1 
              ? ["Resume Challenge 🚀", "Book Free Class 📅"] 
              : day === 2 
                ? ["Book Free Class 📅", "Play Math Game 🎮"]
                : ["Claim Free Spot Now 🎁"],
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
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
                    <div className="control-panel-grid">
                      {/* Sidebar List of Nodes */}
                      <div className="node-list-sidebar">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'white' }}>Journey Nodes</span>
                          <button 
                            className="btn-admin" 
                            style={{ padding: '0.1rem 0.4rem', fontSize: '0.65rem' }}
                            onClick={() => {
                              const newNodeId = prompt("Enter Unique Node ID (e.g. CUSTOM_MESSAGE):");
                              if (newNodeId) {
                                setJourneyNodes(prev => ({
                                  ...prev,
                                  [newNodeId]: {
                                    type: 'message',
                                    responses: [{ text: "Enter message text here...", buttons: [] }],
                                    transitions: {}
                                  }
                                }));
                                setSelectedNodeId(newNodeId);
                              }
                            }}
                          >
                            + Add Node
                          </button>
                        </div>
                        {Object.keys(journeyNodes).map((nodeId) => (
                          <div 
                            key={nodeId}
                            className={`node-list-item ${selectedNodeId === nodeId ? 'node-list-item-active' : ''}`}
                            onClick={() => setSelectedNodeId(nodeId)}
                          >
                            <span>{nodeId}</span>
                            <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>{journeyNodes[nodeId].type}</span>
                          </div>
                        ))}
                      </div>

                      {/* Node Editor Form */}
                      <div className="node-editor-form">
                        {selectedNodeId && journeyNodes[selectedNodeId] ? (
                          <>
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
                                  setJourneyNodes(prev => ({
                                    ...prev,
                                    [selectedNodeId]: { ...prev[selectedNodeId], type }
                                  }));
                                }}
                                style={{ width: '100%' }}
                              >
                                <option value="message">Message Node</option>
                                <option value="game_evaluator">Game Node</option>
                                <option value="profiler">Profiler Node</option>
                                <option value="condition">Condition Node</option>
                              </select>
                            </div>

                            {journeyNodes[selectedNodeId].type === 'message' && (
                              <>
                                <div className="form-group-horizontal" style={{ alignItems: 'flex-start' }}>
                                  <span className="form-label">Message Text</span>
                                  <textarea 
                                    className="form-textarea" 
                                    rows={4}
                                    value={journeyNodes[selectedNodeId].responses?.[0]?.text || ''}
                                    onChange={(e) => {
                                      const text = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.responses = [{ text, buttons: node.responses?.[0]?.buttons || [] }];
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
                                    value={(journeyNodes[selectedNodeId].responses?.[0]?.buttons || []).join(', ')}
                                    onChange={(e) => {
                                      const btns = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.responses = [{ text: node.responses?.[0]?.text || '', buttons: btns }];
                                        return { ...prev, [selectedNodeId]: node };
                                      });
                                    }}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                              </>
                            )}

                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '0.5rem', paddingTop: '0.5rem' }}>
                              <span style={{ fontSize: '0.7rem', fontWeight: 'bold', color: 'white', display: 'block', marginBottom: '0.4rem' }}>Transitions / Next Nodes</span>
                              {journeyNodes[selectedNodeId].type === 'message' && (journeyNodes[selectedNodeId].responses?.[0]?.buttons || []).map((btn) => (
                                <div key={btn} className="form-group-horizontal" style={{ marginBottom: '0.4rem' }}>
                                  <span className="form-label" style={{ fontSize: '0.65rem', color: 'white' }}>On "{btn}"</span>
                                  <select 
                                    className="form-select"
                                    value={journeyNodes[selectedNodeId].transitions?.[btn] || ''}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.transitions = { ...node.transitions, [btn]: next };
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
                              {(!journeyNodes[selectedNodeId].responses?.[0]?.buttons || journeyNodes[selectedNodeId].responses[0].buttons.length === 0) && (
                                <div className="form-group-horizontal">
                                  <span className="form-label">On Default (Any text)</span>
                                  <select 
                                    className="form-select"
                                    value={journeyNodes[selectedNodeId].transitions?.default || ''}
                                    onChange={(e) => {
                                      const next = e.target.value;
                                      setJourneyNodes(prev => {
                                        const node = { ...prev[selectedNodeId] };
                                        node.transitions = { ...node.transitions, default: next };
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
                          </>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '1rem' }}>
                            Select a node from the sidebar to edit.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Deploy Button */}
                    <div className="deploy-section">
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Deploys visual JSON configurations directly to the Config Service database.
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
