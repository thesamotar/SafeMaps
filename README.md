# 🛡️ GoogleMapsSafe

A road hazard alert prototype that warns drivers about upcoming speed bumps, speed tables, and other traffic calming features using real-time location tracking and OpenStreetMap data.

![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)
![Google Maps](https://img.shields.io/badge/Google%20Maps-API-4285F4?logo=googlemaps&logoColor=white)
![OpenStreetMap](https://img.shields.io/badge/OpenStreetMap-Overpass-7EBC6F?logo=openstreetmap&logoColor=white)

---

## 📖 Overview

GoogleMapsSafe is a proof-of-concept application designed to enhance driver safety by providing real-time alerts for road hazards. The app fetches traffic calming data (speed bumps, speed tables, raised crosswalks, etc.) from OpenStreetMap and alerts drivers when they approach these hazards.

### Key Features

- **🗺️ Real-time Map**: Interactive Google Maps centered on your current GPS location
- **🧭 Navigation Mode**: Enter start and destination to get turn-by-turn directions
- **📍 Hazard Detection**: Automatically fetches and displays traffic calming features from OSM
- **🎨 Color-coded Markers**: Visual distinction between hazard types:
  - 🔴 **Red**: Speed bumps and humps
  - 🟡 **Yellow**: Speed tables and raised crosswalks
  - 🟣 **Purple**: Other traffic calming features
- **⚡ Proximity Alerts**: Visual flash and audio warning when within 60 meters of a hazard
- **📊 Live HUD**: Floating display showing current speed, distance to nearest hazard, and alert status
- **🛣️ Route Hazard Detection**: Identifies hazards specifically along your planned route
- **🚗 Simulation Mode**: Test the alert system without physically moving

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Vite** | Fast build tool and development server |
| **Vanilla JavaScript** | Core application logic (no frameworks) |
| **Google Maps JavaScript API** | Map rendering, markers, and geolocation |
| **Google Places API** | Location autocomplete for start/end inputs |
| **Google Directions API** | Route calculation and turn-by-turn navigation |
| **OpenStreetMap Overpass API** | Real-time traffic calming data |
| **Web Audio API** | Warning sound generation |
| **CSS3** | Glassmorphism UI with animations |

---

## 🚀 Setup Instructions

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** (comes with Node.js)
- **Google Maps API Key** with the following APIs enabled:
  - Maps JavaScript API
  - Places API
  - Directions API
  - Geometry Library

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/thesamotar/SafeMaps.git
   cd SafeMaps
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure your API key**
   
   Create a `.env` file in the root directory (or edit the existing one):
   ```env
   VITE_GOOGLE_MAPS_KEY=your_google_maps_api_key_here
   ```
   
   > ⚠️ **Important**: Never commit your `.env` file to version control. It's already listed in `.gitignore`.

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   
   Navigate to `http://localhost:5173`

### Getting a Google Maps API Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Maps JavaScript API**
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. (Recommended) Restrict your API key to specific websites/IPs

---

## 📁 Project Structure

```
SafeMaps/
├── index.html          # Main HTML with HUD overlay
├── package.json        # Project dependencies and scripts
├── .env                # API key (git-ignored)
├── .gitignore          # Git ignore rules
├── README.md           # This file
└── src/
    ├── main.js         # Core application logic
    └── style.css       # Styling with glassmorphism theme
```

---

## 🎮 Usage

### Normal Mode
1. Allow location access when prompted
2. The map will center on your current position
3. Hazards will automatically load for the visible area
4. Move around to see proximity alerts trigger

### Navigation Mode
1. Your current location is auto-filled as the start point
2. Enter a destination in the **"Destination"** field (with autocomplete)
3. Click **"Get Route"** to calculate and display the route
4. View route distance, duration, and hazards along the route
5. Click **"Start Navigation"** to activate turn-by-turn guidance
6. The Navigation HUD appears at the top with directions and ETA
7. Click **"End"** to stop navigation

### Simulation Mode
1. Click **\"Simulate\"** button in the Mode toggle to switch from Normal to Simulate mode
2. Set up a route first (enter destination and click "Get Route")
3. Adjust the simulation speed using the slider (10-120 km/h) or click a preset (20/40/60/80)
4. Click **\"Start Simulation\"** to begin
5. Watch the marker travel along the route at your selected speed
6. Use **\"Pause\"** to pause/resume or **\"Stop\"** to end simulation
7. Progress bar shows how far along the route you've traveled
8. Click **\"Normal\"** button to switch back to real GPS tracking

### Alert Levels
| Distance | Status | Visual |
|----------|--------|--------|
| > 120m | 🟢 Road Clear | Green indicator |
| 60-120m | 🟡 Hazard Nearby | Yellow with pulse |
| < 60m | 🔴 Hazard Ahead! | Red flash + audio beep |

---

## 📋 Change History

### v1.0.0 — Initial Release

**Commit:** `378b60f`  
**Date:** January 22, 2026

#### Changes Made:
- ✅ Scaffolded Vite vanilla JavaScript project
- ✅ Integrated Google Maps JavaScript API with dark theme styling
- ✅ Implemented user geolocation tracking with accuracy circle
- ✅ Created `fetchHazards(bounds)` function to query OSM Overpass API
- ✅ Added color-coded custom markers for different hazard types
- ✅ Built proximity detection system (< 60m threshold)
- ✅ Implemented visual flash overlay for danger alerts
- ✅ Added Web Audio API warning sound (two-tone beep)
- ✅ Created glassmorphism HUD with speed and distance display
- ✅ Added "Simulate Drive" feature for testing without movement
- ✅ Secured API key using environment variables (`import.meta.env`)
- ✅ Configured `.gitignore` to exclude `.env`, `node_modules`, `.DS_Store`

---

### v1.1.0 — Navigation Mode

**Commit:** `145d082`  
**Date:** January 22, 2026

#### Changes Made:
- ✅ Added start and destination location inputs with Google Places Autocomplete
- ✅ Integrated Google Directions API for route calculation
- ✅ Display route on map with distance and duration info
- ✅ Implemented "Start Navigation" mode with turn-by-turn HUD
- ✅ Added Navigation HUD showing next maneuver, distance, and ETA
- ✅ Route-aware hazard detection (highlights hazards on your route)
- ✅ Updated simulation to follow route path when navigation is active
- ✅ Added "Use Current Location" button for start input
- ✅ Added "Clear Route" functionality
- ✅ Styled Google Places autocomplete dropdown to match dark theme
- ✅ Redesigned panel layout to accommodate navigation controls

---

### v1.2.0 — Enhanced Simulation Mode

**Commit:** `302f53f`  
**Date:** January 22, 2026

#### Changes Made:
- ✅ Added Normal/Simulate mode toggle with distinct UI states
- ✅ Replaced simple simulate button with full simulation control panel
- ✅ Added speed slider (10-120 km/h) with real-time speed display
- ✅ Added speed preset buttons (20/40/60/80 km/h) for quick selection
- ✅ Simulation now uses realistic speed-based movement intervals
- ✅ Added Start/Pause/Resume/Stop controls for simulation
- ✅ Added progress bar showing simulation completion percentage
- ✅ Mode indicator in footer shows current mode
- ✅ Normal mode resumes GPS tracking, Simulate mode pauses it
- ✅ Simulation follows route path at configured speed

---

### v1.3.0 — Deceleration Detection & Hazard Reporting

**Commit:** `656b297`  
**Date:** January 24, 2026

#### Changes Made:
- ✅ Added deceleration detection system (monitors speed drops > 15 km/h)
- ✅ Added hazard report modal with 6 classification options (Speed Bump, Pothole, Crossing, Turn, Traffic, Other)
- ✅ Added pending reports modal for reviewing deferred reports at end of navigation
- ✅ Implemented speed history tracking (stores last 5 readings)
- ✅ Smart popup timing: immediate prompt if speed < 20 km/h, deferred if still moving fast
- ✅ Reports stored in localStorage for persistence
- ✅ Works in both real GPS tracking and simulation modes
- ✅ Added glassmorphism styling for report modals
- ✅ Created implementation.md roadmap for future data collection features

---

## 🔮 Future Enhancements

- [ ] Add hazard type filtering in the UI
- [x] ~~Implement route planning with hazard warnings~~ ✅ Done in v1.1.0
- [x] ~~Add simulation with speed control~~ ✅ Done in v1.2.0
- [ ] Add voice alerts using Web Speech API
- [ ] Store user preferences in localStorage
- [ ] Add offline support with service workers
- [x] ~~Implement hazard reporting feature~~ ✅ Done in v1.3.0
- [ ] Add night/day mode toggle
- [ ] Add alternate route suggestions
- [ ] Add accelerometer-based bump detection
- [ ] Add voice-based hazard reporting

---

## 📄 License

This project is for educational and prototype purposes.

---

## 🙏 Acknowledgments

- **OpenStreetMap** contributors for the traffic calming data
- **Google Maps Platform** for the mapping infrastructure
