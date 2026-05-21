# Fixr (ServiceAI v2)

Fixr is an **Agentic Service Orchestrator** designed for the informal economy. It connects users with verified local service providers (AC technicians, electricians, plumbers, etc.) using a multi-agent system built on **Google Antigravity** principles.

## 🚀 Key Features
- **Multi-Agent Orchestration**: 5 specialized agents (Intent, Discovery, Ranking, Booking, Follow-up) perform collaborative reasoning.
- **Agent Trace Logs**: Real-time transparency into how the AI thinks and makes decisions.
- **Voice & Multilingual**: Supports English, Roman Urdu, and Urdu Script via Web Speech API.
- **Premium UI**: Built with a "Horizontal Scroll Journey" and OLED Dark Mode, optimized via **UI Pro Max** design intelligence.
- **Action Simulation**: Live provider tracking on a map with ETA and cost breakdowns.

## 🧠 System Architecture (The Agentic Workflow)
1. **Intent Agent**: Parses user input (voice/text) into structured JSON. Detects service type, location, and urgency.
2. **Discovery Agent**: Filters the provider database based on category and location proximity.
3. **Ranking Agent**: Applies a weighted formula (Rating 40%, Proximity 30%, Availability 20%, Reviews 10%) to pick the best provider.
4. **Booking Agent**: Generates a unique Booking ID, calculates ETA, and builds a cost breakdown.
5. **Follow-up Agent**: Manages the post-booking lifecycle, including arrival notifications and escrow payment release.

## 🛠️ Technology Stack
- **Backend**: Node.js, Express.
- **Agents**: Custom JavaScript logic following Antigravity tool patterns.
- **Frontend**: Vanilla JS, CSS3 (OLED Premium Theme), HTML5.
- **Maps**: Leaflet.js with OpenStreetMap.
- **Voice**: Web Speech API (Recognition & Synthesis).
- **Design Intelligence**: `uipro-cli` (UI Pro Max).

## 📥 Installation
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Start the server: `node server.js`.
4. Access at: `http://localhost:3002`.

## 📜 Agent Trace / Logs
Every request generates a full trace log stored in `data/trace.log`. You can view this live in the "Trace" tab of the application to see the reasoning steps of each agent.

---
*Built for the Google Antigravity Hackathon 2026.*
