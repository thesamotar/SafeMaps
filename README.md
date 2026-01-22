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
- **📍 Hazard Detection**: Automatically fetches and displays traffic calming features from OSM
- **🎨 Color-coded Markers**: Visual distinction between hazard types:
  - 🔴 **Red**: Speed bumps and humps
  - 🟡 **Yellow**: Speed tables and raised crosswalks
  - 🟣 **Purple**: Other traffic calming features
- **⚡ Proximity Alerts**: Visual flash and audio warning when within 60 meters of a hazard
- **📊 Live HUD**: Floating display showing current speed, distance to nearest hazard, and alert status
- **🚗 Simulation Mode**: Test the alert system without physically moving

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| **Vite** | Fast build tool and development server |
| **Vanilla JavaScript** | Core application logic (no frameworks) |
| **Google Maps JavaScript API** | Map rendering, markers, and geolocation |
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

### Simulation Mode
1. Wait for hazards to load (check the counter in the HUD)
2. Click **"Simulate Drive"** button
3. Your position will move toward the nearest hazard
4. Observe the alert system in action
5. Click **"Stop Simulation"** to end

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

## 🔮 Future Enhancements

- [ ] Add hazard type filtering in the UI
- [ ] Implement route planning with hazard warnings
- [ ] Add voice alerts using Web Speech API
- [ ] Store user preferences in localStorage
- [ ] Add offline support with service workers
- [ ] Implement hazard reporting feature
- [ ] Add night/day mode toggle

---

## 📄 License

This project is for educational and prototype purposes.

---

## 🙏 Acknowledgments

- **OpenStreetMap** contributors for the traffic calming data
- **Google Maps Platform** for the mapping infrastructure
