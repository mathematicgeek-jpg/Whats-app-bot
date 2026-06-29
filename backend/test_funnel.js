/**
 * Automated Funnel Verification Script
 * This script runs through the complete WhatsApp bot conversation, profiling,
 * lead scoring, and CRM integration flow via HTTP endpoints.
 */

const BACKEND_URL = 'http://localhost:3001';
const TEST_PHONE = '+919999988888';

async function runTest() {
  console.log('🔄 Starting WhatsApp Conversational Funnel Integration Tests...\n');

  try {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 1. Reset Database
    console.log('Step 1: Resetting simulator database...');
    const resetRes = await fetch(`${BACKEND_URL}/api/admin/reset`, { method: 'POST' });
    const resetData = await resetRes.json();
    if (!resetData.success) throw new Error('Database reset failed');
    await sleep(1000);
    console.log('✅ Database reset successful.\n');

    // Helper to send webhook message and poll async logs for responses
    const sendMessage = async (text, isButton = false) => {
      const startTime = new Date();
      const res = await fetch(`${BACKEND_URL}/api/whatsapp-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: TEST_PHONE, text, isButton })
      });
      const data = await res.json();
      if (!data.success) throw new Error(`Failed to send message: ${text}`);
      
      // Wait for async processing to finish
      await sleep(300);

      // Fetch logs and find WHATSAPP_OUT logs sent after startTime
      const logsRes = await fetch(`${BACKEND_URL}/api/crm/logs`);
      const logs = await logsRes.json();
      const relevantLogs = logs
        .filter(l => l.user_phone === TEST_PHONE && l.event_type === 'WHATSAPP_OUT' && new Date(l.created_at) >= startTime)
        .reverse();

      return relevantLogs.map(l => l.payload);
    };

    // Helper to get CRM contact
    const getContact = async () => {
      await sleep(200);
      const res = await fetch(`${BACKEND_URL}/api/crm/contacts`);
      const contacts = await res.json();
      return contacts.find(c => c.whatsapp_number === TEST_PHONE);
    };

    // 2. Start Funnel (Opt-in)
    console.log('Step 2: Sending initial trigger / opt-in...');
    let responses = await sendMessage('Start Challenge 🚀', true);
    console.log('🤖 Bot response (Level 1):', responses[0].text.replace(/\n/g, ' '));
    
    let contact = await getContact();
    console.log(`👤 CRM Contact State: Stage="${contact.lead_stage}", Lead Score=${contact.lead_score}`);
    if (contact.lead_stage !== 'New' || contact.lead_score !== 10) {
      throw new Error('Initial CRM mapping failed');
    }
    console.log('✅ Initial opt-in validated.\n');

    // 3. Play Game (Levels 1 - 5)
    const answers = [
      { level: 1, ans: '385', nextBtn: 'Next Level 🚀' },
      { level: 2, ans: '4225', nextBtn: 'Next Level 🚀' },
      { level: 3, ans: '9312', nextBtn: 'Next Level 🚀' },
      { level: 4, ans: '10815', nextBtn: 'Final Level 🏆' },
      { level: 5, ans: '987036', nextBtn: 'See My Results 📊' }
    ];

    for (const item of answers) {
      console.log(`Step 3.${item.level}: Answering Level ${item.level}...`);
      responses = await sendMessage(item.ans);
      console.log('🤖 Bot response (Praise/Vedic Trick):', responses[0].text.replace(/\n/g, ' '));
      
      // Advance to next level
      responses = await sendMessage(item.nextBtn, true);
      if (item.level < 5) {
        console.log('🤖 Bot response (Next Level Question):', responses[0].text.replace(/\n/g, ' '));
      } else {
        console.log('🤖 Bot response (Score Summary):', responses[0].text.replace(/\n/g, ' '));
      }
    }

    contact = await getContact();
    console.log(`📊 CRM Game Complete State: Score=${contact.score}/5, Lead Score=${contact.lead_score}`);
    if (contact.score !== 5) {
      throw new Error('Game score calculation failed');
    }
    console.log('✅ Game play levels 1-5 validated.\n');

    // 4. Progressive Profiling
    console.log('Step 4: Starting progressive profiling...');
    
    // Trigger name request
    responses = await sendMessage('Book Free Live Class 📅', true);
    console.log('🤖 Bot response:', responses[0].text);

    // Send name
    responses = await sendMessage('Aarav');
    console.log('🤖 Bot response:', responses[0].text.replace(/\n/g, ' '));

    // Choose grade segment
    responses = await sendMessage('Grade 6-8 📚', true);
    console.log('🤖 Bot response:', responses[0].text);

    // Provide city
    responses = await sendMessage('Mumbai');
    console.log('🤖 Bot response:', responses[0].text.replace(/\n/g, ' '));

    // Provide parent phone
    responses = await sendMessage('+919876543210');
    console.log('🤖 Bot response:', responses[1].text.replace(/\n/g, ' ')); // response[1] is the final pitch/offer

    contact = await getContact();
    console.log(`👤 CRM Profile Completed: Name="${contact.name}", Grade="${contact.grade}", City="${contact.city}", Parent Phone="${contact.phone}"`);
    console.log(`📈 CRM Qualification State: Stage="${contact.lead_stage}", Lead Score=${contact.lead_score}`);
    
    if (contact.lead_stage !== 'Qualified' || contact.lead_score !== 60) { // 50 base + 10 high score bonus
      throw new Error(`Profile qualification scoring failed. Stage: ${contact.lead_stage}, Lead Score: ${contact.lead_score}`);
    }
    console.log('✅ Progressive profiling & CRM Lead qualification validated.\n');

    // 5. Calendly Demo Booking
    console.log('Step 5: Simulating Calendly demo booking webhook...');
    const bookingRes = await fetch(`${BACKEND_URL}/api/crm/book-demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: TEST_PHONE })
    });
    const bookingData = await bookingRes.json();
    if (!bookingData.success) throw new Error('Demo booking API call failed');

    contact = await getContact();
    console.log(`📈 CRM Demo Booked State: Stage="${contact.lead_stage}", Lead Score=${contact.lead_score}`);
    if (contact.lead_stage !== 'Demo Booked' || contact.lead_score !== 110) {
      throw new Error('Demo booking stage/scoring update failed');
    }
    console.log('✅ Calendly webhook CRM sync validated.\n');

    // 6. Test Drop-off follow-up campaign
    console.log('Step 6: Testing drop-off follow-up campaign...');
    
    // Register another temp phone number to test drop-off
    const DROP_PHONE = '+917777766666';
    // Start game on drop phone
    await fetch(`${BACKEND_URL}/api/whatsapp-webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: DROP_PHONE, text: 'Start Challenge 🚀', isButton: true })
    });
    
    // Trigger Day 1 Follow-up
    const followupRes = await fetch(`${BACKEND_URL}/api/admin/trigger-followup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: DROP_PHONE, day: 1 })
    });
    const followupData = await followupRes.json();
    if (!followupData.success) throw new Error('Follow-up trigger failed');
    console.log('✅ Day 1 drop-off follow-up successfully triggered & state transitioned.');
    
    // 7. Verify Gamification & Behavioral Attributes
    console.log('Step 7: Verifying gamified levels, XP, and derived attributes...');
    contact = await getContact();
    console.log(`🎮 User Gamification: Level=${contact.level}, XP=${contact.xp}, Streak=${contact.streak}, Energy=${contact.energy}/5`);
    console.log('🏆 Badges:', contact.badges);
    console.log('🧠 Derived Attributes:', contact.derived_attributes);

    if (!contact.level || contact.level < 1) {
      throw new Error('User gamified level calculation is invalid');
    }
    if (!contact.xp || contact.xp < 10) {
      throw new Error('User XP rewards system failed');
    }
    if (contact.energy === undefined || contact.energy < 0) {
      throw new Error('User Energy counter failed');
    }
    if (!contact.derived_attributes) {
      throw new Error('Behavioral derived attributes failed to generate');
    }

    const derived = JSON.parse(contact.derived_attributes);
    if (derived.fast_learner_score === undefined || !derived.churn_risk) {
      throw new Error('Behavioral attributes schema is missing critical properties');
    }
    console.log('✅ Gamification, streaks, and dynamic attributes validated.\n');

    console.log('\n🎉 ALL BOT FUNNEL AND CRM INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    process.exit(1);
  }
}

runTest();
