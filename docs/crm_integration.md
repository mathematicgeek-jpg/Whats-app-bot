# CRM Integration & Webhook Specification

This document outlines the variables tracked during the session, CRM database schemas, webhook structures, lead scoring rules, and automated workflow triggers.

---

## 💾 State Variable Structure (Session Scope)

The bot engine manages the following session variables for each active user.

| Variable Name | Type | Initial Value | Description |
| :--- | :--- | :--- | :--- |
| `whatsapp_number` | String | *From Webhook* | Unique WhatsApp Identifier (typically E.164 phone number) |
| `score` | Integer | `0` | Count of correct mathematical answers (0 to 5) |
| `current_level` | Integer | `1` | Current game level (1 to 5) |
| `user_answers` | Object | `{}` | Key-value store of user answers per level (e.g. `{"l1": 385}`) |
| `lead_stage` | String | `"New"` | Current sales funnel stage (`New`, `Engaged`, `Qualified`, `Demo Booked`) |
| `lead_score` | Integer | `0` | Dynamic score for prioritization (max 110) |
| `name` | String | `null` | Student name |
| `grade` | String | `null` | Age/Grade segment (`Grades 3-5`, `Grades 6-8`, `Grades 9-12`) |
| `city` | String | `null` | City of residence |
| `parent_phone` | String | `null` | Verified backup contact phone |
| `demo_booked` | Boolean | `false` | True if user selects a Calendly slot |

---

## 🏛️ CRM Contact Schema & Mapping (HubSpot / Zoho)

We map the session variables to custom properties in the CRM contact object.

| WhatsApp Variable | CRM Property API Name | Type | Notes / Enum Values |
| :--- | :--- | :--- | :--- |
| `name` | `firstname` | String | Captured in profiling |
| `parent_phone` | `phone` | String | Main phone number for SMS/Calling |
| `whatsapp_number` | `whatsapp_number` | String | Custom field (Key for WhatsApp campaigns) |
| `grade` | `student_grade` | Dropdown | `Grades 3-5` \| `Grades 6-8` \| `Grades 9-12` |
| `city` | `city` | String | City name |
| `score` | `vedic_game_score` | Integer | Out of 5 |
| `lead_stage` | `lead_stage` | Dropdown | `New` \| `Engaged` \| `Qualified` \| `Demo Booked` |
| `lead_score` | `lead_score` | Integer | Used for priority scoring |
| *Fixed* | `hs_lead_status` | String | `"WhatsApp Game Funnel"` (Source identification) |

---

## 🔄 Webhook Payload Specifications

### 1. Lead Captured Trigger (On Profile Completion)
* **Trigger Event**: Fired the moment the user answers the final profiling question (`parent_phone` or skips it).
* **HTTP Method**: `POST`
* **Endpoint (Sample)**: `https://api.hubapi.com/crm/v3/objects/contacts` or `https://make.com/incoming-webhook/...`
* **JSON Payload**:
```json
{
  "properties": {
    "firstname": "Aarav",
    "phone": "+919876543210",
    "whatsapp_number": "+919876543210",
    "student_grade": "Grades 6-8",
    "city": "Mumbai",
    "vedic_game_score": "4",
    "lead_stage": "Qualified",
    "lead_score": "40",
    "hs_lead_status": "WhatsApp Game Funnel"
  }
}
```

### 2. Demo Clicked / Booked Trigger
* **Trigger Event**: Fired when a student clicks `Book Free Slot 📅` or completes the booking via widget redirect.
* **HTTP Method**: `POST`
* **JSON Payload**:
```json
{
  "event": "demo_booked",
  "whatsapp_number": "+919876543210",
  "lead_stage": "Demo Booked",
  "lead_score": 90,
  "booking_details": {
    "calendar_event_id": "cal_9921827",
    "scheduled_time": "2026-06-30T15:30:00Z",
    "timezone": "Asia/Kolkata"
  }
}
```

---

## 📈 Lead Scoring Logic

Our automation engine recalculates Lead Score in real-time. High-priority leads are routed directly to sales representatives for follow-ups.

| Activity / Event | Score Value | Cumulative Score Scenario |
| :--- | :--- | :--- |
| Game Started | `+10` | 10 (Stage: `New`) |
| Completed 5 Game Levels | `+20` | 30 (Stage: `Engaged`) |
| Scored High ($>80\%$) | `+10` | 40 (Engaged + Smart Lead) |
| Profile Completed (Lead Capture) | `+10` | 50 (Stage: `Qualified`) |
| Clicked Demo Booking Link | `+20` | 70 |
| Demo Confirmed / Booked | `+40` | 110 (Stage: `Demo Booked`) |

---

## 🚨 Internal Sales Alert Routing

When a high-priority event is triggered, the system dispatches instant alerts.

### Trigger Conditions
1. **Condition A**: `lead_score` $\ge$ 40 AND `lead_stage` = `"Qualified"` (Hot lead, no demo booked yet).
2. **Condition B**: `lead_stage` = `"Demo Booked"` (Class scheduled).

### Alert Payload (Slack / Email Channel)
* **Slack Payload Example**:
```json
{
  "text": "🔥 *HOT LEAD ALERT: WhatsApp Vedic Maths Game* 🔥\n\n*Name:* Aarav\n*Grade:* Grades 6-8 (Middle School)\n*City:* Mumbai\n*Game Score:* 4/5 (Top 15%)\n*Lead Score:* 50\n*WhatsApp:* https://wa.me/919876543210\n\n*Action Required:* User completed the profiling but hasn't booked a demo slot yet. Reach out to schedule!",
  "channel": "#sales-alerts",
  "username": "Vedic Math Bot"
}
```

---

## 🛤️ CRM Pipeline Stage Transitions

We automatically move leads across stages inside the Sales Pipeline:

```
[New Lead] ─────────► [Engaged] ──────────► [Qualified] ─────────► [Demo Booked]
  │                     │                     │                     │
  ▼                     ▼                     ▼                     ▼
Starts Game         Finishes 5 levels      Completes profiling   Schedules free slot
```

### Automation Workflows (Zapier/Make/CRM Actions)
1. **Workflow 1: Engagement Trigger**
   * *Trigger*: Custom webhook event `game_completed`.
   * *Action*: Update contact `lead_stage` to `"Engaged"`.
2. **Workflow 2: Qualification Trigger**
   * *Trigger*: Custom webhook event `lead_captured`.
   * *Action*: Update contact `lead_stage` to `"Qualified"`. Trigger Day 1 Follow-up script if demo is not booked within 2 hours.
3. **Workflow 3: Demo Booking Update**
   * *Trigger*: Calendly invitee created webhook.
   * *Action*: Search CRM for matching email/phone. Update stage to `"Demo Booked"`, cancel all pending drop-off campaign reminders.
