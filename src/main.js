import './style.css';
import { initializeFirebase, saveHazardToFirestore, fetchCrowdsourcedHazards, isFirebaseConfigured } from './firebase.js';

// ===== Configuration =====
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const ALERT_DISTANCE = 60; // meters
const LOCATION_POLL_INTERVAL = 2000; // ms
const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';

// ===== State =====
let map = null;
let userMarker = null;
let hazardMarkers = [];
let hazards = [];
let userPosition = null;
let lastPosition = null;
let lastTimestamp = null;
let locationWatchId = null;
let audioContext = null;

// Navigation State
let directionsService = null;
let directionsRenderer = null;
let startAutocomplete = null;
let endAutocomplete = null;
let startPlace = null;
let endPlace = null;
let currentRoute = null;
let navigationActive = false;
let routeHazards = [];

// Enhanced Simulation State
let appMode = 'normal'; // 'normal' or 'simulate'
let simulationActive = false;
let simulationPaused = false;
let simulationSpeed = 30; // km/h
let simulationIndex = 0;
let simulationPath = [];
let simulationInterval = null;
let simulationStartPosition = null;

// ===== Theme State =====
let currentTheme = localStorage.getItem('theme') || 'dark';

// ===== Deceleration Detection State =====
const DECEL_THRESHOLD = 15; // km/h drop to trigger detection
const LOW_SPEED_THRESHOLD = 20; // km/h - if speed below this, show immediate popup
const SPEED_HISTORY_SIZE = 5; // Number of speed readings to track
let speedHistory = []; // Array of {speed, timestamp, position}
let pendingReports = []; // Reports that need user input (other/high-speed cases)
let currentDecelEvent = null; // Current deceleration event awaiting classification
let reportModalTimeout = null; // Timeout for auto-closing modal

// ===== Vertical Jolt Detection State =====
const JOLT_THRESHOLD = 1.5;        // g-force threshold for jolt detection
const JOLT_MIN_SPEED = 10;         // km/h - minimum speed to consider jolt valid
const JOLT_COOLDOWN = 2000;        // ms - cooldown between jolt detections
let accelerometerActive = false;
let lastJoltTime = 0;
let motionPermissionGranted = false;
let currentJoltEvent = null;       // Current jolt event awaiting classification

// ===== Voice Alert Configuration =====
const VOICE_ALERT_COOLDOWN = 5000;      // ms - prevent repeated alerts for same hazard
let voiceAlertsEnabled = localStorage.getItem('voiceAlerts') !== 'false'; // default ON
let voiceVolume = parseFloat(localStorage.getItem('voiceVolume')) || 1.0;
let lastVoiceAlertTime = 0;
let lastVoiceAlertHazardId = null;
let speechSynthesis = window.speechSynthesis;

// ===== Voice Recognition Configuration =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognitionSupported = !!SpeechRecognition;
let recognition = null;
let isListening = false;

// Keyword mapping for hazard types
const HAZARD_KEYWORDS = {
    'speed_bump': ['speed bump', 'bump', 'hump', 'speed breaker', 'breaker'],
    'pothole': ['pothole', 'pot hole', 'hole', 'crater'],
    'crossing': ['crossing', 'crosswalk', 'pedestrian', 'zebra'],
    'turn': ['turn', 'sharp turn', 'curve', 'bend'],
    'traffic': ['traffic', 'congestion', 'jam', 'slow traffic'],
    'other': ['other', 'something', 'unknown', 'else']
};

// ===== Sequential Pending Reports Review State =====
let pendingReviewIndex = 0;
let pendingReviewMarker = null;
let isReviewingPending = false;

// ===== DOM Elements =====
const speedValue = document.getElementById('speed-value');
const distanceValue = document.getElementById('distance-value');
const alertStatus = document.getElementById('alert-status');
const flashOverlay = document.getElementById('flash-overlay');
const hazardCount = document.getElementById('hazard-count');

// Navigation DOM Elements
const startInput = document.getElementById('start-input');
const endInput = document.getElementById('end-input');
const useLocationBtn = document.getElementById('use-location-btn');
const getRouteBtn = document.getElementById('get-route-btn');
const navInfo = document.getElementById('nav-info');
const routeDistanceEl = document.getElementById('route-distance');
const routeDurationEl = document.getElementById('route-duration');
const startNavBtn = document.getElementById('start-nav-btn');
const clearRouteBtn = document.getElementById('clear-route-btn');
const navHud = document.getElementById('nav-hud');
const navStepDistance = document.getElementById('nav-step-distance');
const navStepAction = document.getElementById('nav-step-action');
const navEtaTime = document.getElementById('nav-eta-time');
const navIcon = document.getElementById('nav-icon');
const endNavBtn = document.getElementById('end-nav-btn');

// Mode Toggle DOM Elements
const normalModeBtn = document.getElementById('normal-mode-btn');
const simulateModeBtn = document.getElementById('simulate-mode-btn');
const simulationControls = document.getElementById('simulation-controls');
const simSpeedInput = document.getElementById('sim-speed-input');
const simSpeedDisplay = document.getElementById('sim-speed-display');
const speedPresets = document.querySelectorAll('.speed-preset');
const startSimBtn = document.getElementById('start-sim-btn');
const pauseSimBtn = document.getElementById('pause-sim-btn');
const stopSimBtn = document.getElementById('stop-sim-btn');
const simProgress = document.getElementById('sim-progress');
const simProgressFill = document.getElementById('sim-progress-fill');
const simProgressText = document.getElementById('sim-progress-text');
const modeIndicator = document.getElementById('mode-indicator');

// Hazard Report Modal DOM Elements
const hazardReportModal = document.getElementById('hazard-report-modal');
const reportOptions = document.querySelectorAll('.report-option');
const skipReportBtn = document.getElementById('skip-report-btn');
const pendingReportsModal = document.getElementById('pending-reports-modal');
const pendingReportsList = document.getElementById('pending-reports-list');
const submitPendingBtn = document.getElementById('submit-pending-btn');
const dismissPendingBtn = document.getElementById('dismiss-pending-btn');

// Theme Toggle DOM Elements
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeIcon = document.getElementById('theme-icon');

// Voice Toggle DOM Elements
const voiceToggleBtn = document.getElementById('voice-toggle-btn');
const voiceIcon = document.getElementById('voice-icon');

// Testing Panel DOM Elements
const testingPanel = document.getElementById('testing-panel');
const testingPanelToggle = document.getElementById('testing-panel-toggle');

// ===== Testing Panel Collapse Toggle =====
function toggleTestingPanel() {
    if (testingPanel) {
        testingPanel.classList.toggle('collapsed');
    }
}

// Initialize testing panel as collapsed by default
if (testingPanel) {
    testingPanel.classList.add('collapsed');
}

// ===== Google Maps Loader =====
async function loadGoogleMapsAPI() {
    return new Promise((resolve, reject) => {
        if (window.google && window.google.maps) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=geometry,places`;
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Google Maps API'));
        document.head.appendChild(script);
    });
}

// ===== Map Initialization =====
async function initMap() {
    try {
        // Initialize Firebase (optional - works without config)
        initializeFirebase();

        await loadGoogleMapsAPI();

        // Get user's current position
        const position = await getCurrentPosition();
        userPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        // Create map centered on user location
        map = new google.maps.Map(document.getElementById('map'), {
            center: userPosition,
            zoom: 15,
            styles: getMapStyles(),
            disableDefaultUI: true,
            zoomControl: true,
            zoomControlOptions: {
                position: google.maps.ControlPosition.RIGHT_CENTER
            }
        });

        // Create user marker
        userMarker = new google.maps.Marker({
            position: userPosition,
            map: map,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#4285f4',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3
            },
            zIndex: 1000
        });

        // Add accuracy circle
        new google.maps.Circle({
            map: map,
            center: userPosition,
            radius: position.coords.accuracy,
            fillColor: '#4285f4',
            fillOpacity: 0.1,
            strokeColor: '#4285f4',
            strokeOpacity: 0.3,
            strokeWeight: 1
        });

        // Initialize Directions Service and Renderer
        directionsService = new google.maps.DirectionsService();
        directionsRenderer = new google.maps.DirectionsRenderer({
            map: map,
            suppressMarkers: false,
            polylineOptions: {
                strokeColor: '#4285f4',
                strokeWeight: 5,
                strokeOpacity: 0.8
            }
        });

        // Initialize Places Autocomplete
        initAutocomplete();

        // Fetch hazards when map loads
        google.maps.event.addListenerOnce(map, 'idle', () => {
            fetchHazards(map.getBounds());
        });

        // Refetch hazards when bounds change significantly
        map.addListener('idle', debounce(() => {
            fetchHazards(map.getBounds());
        }, 1000));

        // Start location polling
        startLocationPolling();

        // Set start input to current location
        reverseGeocode(userPosition).then(address => {
            startInput.value = address;
            startInput.dataset.lat = userPosition.lat;
            startInput.dataset.lng = userPosition.lng;
        });

        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Error initializing map:', error);
        alert('Error initializing map: ' + error.message);
    }
}

// ===== Initialize Autocomplete =====
function initAutocomplete() {
    const options = {
        fields: ['formatted_address', 'geometry', 'name'],
        strictBounds: false
    };

    // Start location autocomplete
    startAutocomplete = new google.maps.places.Autocomplete(startInput, options);
    startAutocomplete.addListener('place_changed', () => {
        const place = startAutocomplete.getPlace();
        if (place.geometry) {
            startPlace = {
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
                address: place.formatted_address || place.name
            };
            startInput.dataset.lat = startPlace.lat;
            startInput.dataset.lng = startPlace.lng;
        }
    });

    // End location autocomplete
    endAutocomplete = new google.maps.places.Autocomplete(endInput, options);
    endAutocomplete.addListener('place_changed', () => {
        const place = endAutocomplete.getPlace();
        if (place.geometry) {
            endPlace = {
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng(),
                address: place.formatted_address || place.name
            };
            endInput.dataset.lat = endPlace.lat;
            endInput.dataset.lng = endPlace.lng;
        }
    });
}

// ===== Reverse Geocode =====
async function reverseGeocode(position) {
    return new Promise((resolve) => {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: position }, (results, status) => {
            if (status === 'OK' && results[0]) {
                resolve(results[0].formatted_address);
            } else {
                resolve(`${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`);
            }
        });
    });
}

// ===== Get Route =====
async function getRoute() {
    // Get start location
    let origin;
    if (startInput.dataset.lat && startInput.dataset.lng) {
        origin = {
            lat: parseFloat(startInput.dataset.lat),
            lng: parseFloat(startInput.dataset.lng)
        };
    } else if (startInput.value.trim()) {
        origin = startInput.value.trim();
    } else {
        alert('Please enter a start location');
        return;
    }

    // Get end location
    let destination;
    if (endInput.dataset.lat && endInput.dataset.lng) {
        destination = {
            lat: parseFloat(endInput.dataset.lat),
            lng: parseFloat(endInput.dataset.lng)
        };
    } else if (endInput.value.trim()) {
        destination = endInput.value.trim();
    } else {
        alert('Please enter a destination');
        return;
    }

    getRouteBtn.disabled = true;
    getRouteBtn.innerHTML = '<span class="btn-icon">⏳</span> Getting Route...';

    try {
        const result = await new Promise((resolve, reject) => {
            directionsService.route({
                origin: origin,
                destination: destination,
                travelMode: google.maps.TravelMode.DRIVING
            }, (result, status) => {
                if (status === 'OK') {
                    resolve(result);
                } else {
                    reject(new Error(`Directions request failed: ${status}`));
                }
            });
        });

        // Display the route
        directionsRenderer.setDirections(result);
        currentRoute = result;

        // Get route info
        const route = result.routes[0];
        const leg = route.legs[0];

        // Update UI
        routeDistanceEl.textContent = leg.distance.text;
        routeDurationEl.textContent = leg.duration.text;
        navInfo.classList.remove('hidden');

        // Fetch hazards along the route
        await fetchHazardsAlongRoute(route);

        // Fit map to route bounds
        map.fitBounds(route.bounds);

    } catch (error) {
        console.error('Error getting route:', error);
        alert('Could not get route: ' + error.message);
    } finally {
        getRouteBtn.disabled = false;
        getRouteBtn.innerHTML = '<span class="btn-icon">🧭</span> Get Route';
    }
}

// ===== Fetch Hazards Along Route =====
async function fetchHazardsAlongRoute(route) {
    const bounds = route.bounds;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // Clear existing markers
    hazardMarkers.forEach(m => { m.background.setMap(null); m.icon.setMap(null); });
    hazardMarkers = [];
    hazards = [];
    routeHazards = [];

    // Get the route path for distance checking
    const routePath = route.overview_path;

    // Fetch from both OSM and Firestore in parallel
    const osmQuery = `
    [out:json][timeout:25];
    (
      node["traffic_calming"](${sw.lat()},${sw.lng()},${ne.lat()},${ne.lng()});
    );
    out body;
  `;

    try {
        // Fetch OSM hazards
        const osmPromise = fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: `data=${encodeURIComponent(osmQuery)}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }).then(res => res.ok ? res.json() : { elements: [] })
            .catch(() => ({ elements: [] }));

        // Fetch crowdsourced hazards from Firestore
        const firestoreBounds = {
            north: ne.lat(),
            south: sw.lat(),
            east: ne.lng(),
            west: sw.lng()
        };
        const crowdsourcedPromise = fetchCrowdsourcedHazards(firestoreBounds);

        const [osmData, crowdsourcedData] = await Promise.all([osmPromise, crowdsourcedPromise]);

        // Process OSM hazard data
        osmData.elements.forEach(element => {
            const hazardPos = { lat: element.lat, lng: element.lon };
            const isNearRoute = isPointNearPath(hazardPos, routePath, 50);

            const hazard = {
                id: `osm_${element.id}`,
                lat: element.lat,
                lng: element.lon,
                type: element.tags.traffic_calming || 'unknown',
                name: element.tags.name || null,
                onRoute: isNearRoute,
                source: 'osm'
            };

            hazards.push(hazard);
            if (isNearRoute) {
                routeHazards.push(hazard);
            }
            createHazardMarker(hazard);
        });

        // Process crowdsourced hazards from Firestore
        crowdsourcedData.forEach(csHazard => {
            const hazardPos = { lat: csHazard.lat, lng: csHazard.lng };
            const isNearRoute = isPointNearPath(hazardPos, routePath, 50);

            const hazard = {
                id: `cs_${csHazard.id}`,
                lat: csHazard.lat,
                lng: csHazard.lng,
                type: csHazard.type || 'unknown',
                name: null,
                onRoute: isNearRoute,
                source: 'crowdsourced',
                verified: csHazard.verified,
                verificationCount: csHazard.verificationCount
            };

            hazards.push(hazard);
            if (isNearRoute) {
                routeHazards.push(hazard);
            }
            createHazardMarker(hazard);
        });

        // Update hazard count
        const osmCount = osmData.elements.length;
        const csCount = crowdsourcedData.length;
        hazardCount.textContent = `${routeHazards.length} hazards on route`;
        console.log(`Found ${routeHazards.length} hazards on route (${osmCount} OSM, ${csCount} crowdsourced)`);

    } catch (error) {
        console.error('Error fetching hazards along route:', error);
    }
}

// ===== Check if point is near path =====
function isPointNearPath(point, path, maxDistance) {
    const pointLatLng = new google.maps.LatLng(point.lat, point.lng);

    for (let i = 0; i < path.length - 1; i++) {
        const segmentStart = path[i];
        const segmentEnd = path[i + 1];

        // Get distance from point to line segment
        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            pointLatLng,
            findClosestPointOnSegment(pointLatLng, segmentStart, segmentEnd)
        );

        if (distance <= maxDistance) {
            return true;
        }
    }

    return false;
}

// ===== Find closest point on line segment =====
function findClosestPointOnSegment(point, segStart, segEnd) {
    const startLat = segStart.lat();
    const startLng = segStart.lng();
    const endLat = segEnd.lat();
    const endLng = segEnd.lng();
    const pointLat = point.lat();
    const pointLng = point.lng();

    const dx = endLat - startLat;
    const dy = endLng - startLng;

    if (dx === 0 && dy === 0) {
        return segStart;
    }

    const t = Math.max(0, Math.min(1,
        ((pointLat - startLat) * dx + (pointLng - startLng) * dy) / (dx * dx + dy * dy)
    ));

    return new google.maps.LatLng(
        startLat + t * dx,
        startLng + t * dy
    );
}

// ===== Start Navigation =====
function startNavigation() {
    if (!currentRoute) {
        alert('Please get a route first');
        return;
    }

    navigationActive = true;

    // Hide nav panel route section and show nav HUD
    navHud.classList.remove('hidden');

    // Update navigation HUD with first step
    updateNavigationHUD();

    // Update button state
    startNavBtn.innerHTML = '<span class="btn-icon">●</span> Navigating...';
    startNavBtn.disabled = true;

    // Start accelerometer tracking for jolt detection
    startAccelerometerTracking();

    console.log('Navigation started');
}

// ===== End Navigation =====
function endNavigation() {
    navigationActive = false;
    navHud.classList.add('hidden');

    startNavBtn.innerHTML = '<span class="btn-icon">▶</span> Start Navigation';
    startNavBtn.disabled = false;

    // Clear speed history
    speedHistory = [];

    // Stop accelerometer tracking
    stopAccelerometerTracking();

    // Check for pending reports
    if (pendingReports.length > 0) {
        showPendingReportsModal();
    }

    console.log('Navigation ended');
}

// ===== Update Navigation HUD =====
function updateNavigationHUD() {
    if (!currentRoute || !navigationActive) return;

    const route = currentRoute.routes[0];
    const leg = route.legs[0];

    // Find the next step based on current position
    let nextStep = leg.steps[0];
    let distanceToStep = '--';

    if (userPosition) {
        // Find closest step
        let minDistance = Infinity;
        for (const step of leg.steps) {
            const stepStart = {
                lat: step.start_location.lat(),
                lng: step.start_location.lng()
            };
            const distance = calculateDistance(userPosition, stepStart);
            if (distance < minDistance) {
                minDistance = distance;
                nextStep = step;
                distanceToStep = formatDistance(distance);
            }
        }
    }

    // Update HUD
    navStepDistance.textContent = distanceToStep;
    navStepAction.textContent = stripHtml(nextStep.instructions) || 'Continue on route';
    navEtaTime.textContent = leg.duration.text;

    // Update icon based on maneuver
    navIcon.textContent = getManeuverIcon(nextStep.maneuver);
}

// ===== Get Maneuver Icon =====
function getManeuverIcon(maneuver) {
    const icons = {
        'turn-left': '←',
        'turn-right': '→',
        'turn-slight-left': '↖',
        'turn-slight-right': '↗',
        'turn-sharp-left': '↰',
        'turn-sharp-right': '↱',
        'uturn-left': '↩',
        'uturn-right': '↪',
        'straight': '↑',
        'merge': '⤵',
        'ramp-left': '↙',
        'ramp-right': '↘',
        'fork-left': '⑂',
        'fork-right': '⑂',
        'roundabout-left': '↺',
        'roundabout-right': '↻'
    };
    return icons[maneuver] || '↑';
}

// ===== Format Distance =====
function formatDistance(meters) {
    if (meters >= 1000) {
        return (meters / 1000).toFixed(1) + ' km';
    }
    return Math.round(meters) + ' m';
}

// ===== Strip HTML =====
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return tmp.textContent || tmp.innerText || '';
}

// ===== Clear Route =====
function clearRoute() {
    directionsRenderer.setDirections({ routes: [] });
    currentRoute = null;
    navInfo.classList.add('hidden');
    endNavigation();

    // Clear end input
    endInput.value = '';
    delete endInput.dataset.lat;
    delete endInput.dataset.lng;
    endPlace = null;

    // Clear route hazards
    routeHazards = [];
    hazardCount.textContent = `${hazards.length} hazards loaded`;
}

// ===== Use Current Location =====
async function useCurrentLocation() {
    try {
        const position = await getCurrentPosition();
        userPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
        };

        const address = await reverseGeocode(userPosition);
        startInput.value = address;
        startInput.dataset.lat = userPosition.lat;
        startInput.dataset.lng = userPosition.lng;

        // Update marker
        userMarker.setPosition(userPosition);
        map.panTo(userPosition);

    } catch (error) {
        console.error('Error getting current location:', error);
        alert('Could not get current location');
    }
}

// ===== Get Current Position =====
function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
    });
}

// ===== Fetch Hazards from OSM Overpass API =====
async function fetchHazards(bounds) {
    if (!bounds || currentRoute) return; // Don't fetch if route is active

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    // Overpass QL query for traffic_calming nodes
    const query = `
    [out:json][timeout:25];
    (
      node["traffic_calming"](${sw.lat()},${sw.lng()},${ne.lat()},${ne.lng()});
    );
    out body;
  `;

    try {
        const response = await fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (!response.ok) {
            throw new Error('Overpass API request failed');
        }

        const data = await response.json();

        // Clear existing markers
        hazardMarkers.forEach(m => { m.background.setMap(null); m.icon.setMap(null); });
        hazardMarkers = [];
        hazards = [];

        // Process hazard data
        data.elements.forEach(element => {
            const hazard = {
                id: element.id,
                lat: element.lat,
                lng: element.lon,
                type: element.tags.traffic_calming || 'unknown',
                name: element.tags.name || null,
                onRoute: false
            };
            hazards.push(hazard);
            createHazardMarker(hazard);
        });

        // Update hazard count
        hazardCount.textContent = `${hazards.length} hazards loaded`;
        console.log(`Loaded ${hazards.length} hazards from OSM`);

    } catch (error) {
        console.error('Error fetching hazards:', error);
    }
}

// ===== Hazard Marker Color Schemes =====
// Vibrant color schemes for each hazard type: [background, icon fill, icon stroke]
const HAZARD_COLOR_SCHEMES = {
    bump: { bg: '#ff6b6b', icon: '#ffffff', stroke: '#c0392b' },
    hump: { bg: '#ff6b6b', icon: '#ffffff', stroke: '#c0392b' },
    speed_bump: { bg: '#ff6b6b', icon: '#ffffff', stroke: '#c0392b' },
    table: { bg: '#f39c12', icon: '#ffffff', stroke: '#d68910' },
    raised_crosswalk: { bg: '#f1c40f', icon: '#2c3e50', stroke: '#f39c12' },
    cushion: { bg: '#e67e22', icon: '#ffffff', stroke: '#d35400' },
    rumble_strip: { bg: '#9b59b6', icon: '#ffffff', stroke: '#8e44ad' },
    pothole: { bg: '#e74c3c', icon: '#ffffff', stroke: '#c0392b' },
    crossing: { bg: '#3498db', icon: '#ffffff', stroke: '#2980b9' },
    turn: { bg: '#9b59b6', icon: '#ffffff', stroke: '#8e44ad' },
    traffic: { bg: '#f39c12', icon: '#2c3e50', stroke: '#d68910' },
    chicane: { bg: '#1abc9c', icon: '#ffffff', stroke: '#16a085' },
    choker: { bg: '#e67e22', icon: '#ffffff', stroke: '#d35400' },
    island: { bg: '#2ecc71', icon: '#ffffff', stroke: '#27ae60' },
    crowdsourced: { bg: '#00bcd4', icon: '#ffffff', stroke: '#00838f' },
    default: { bg: '#95a5a6', icon: '#ffffff', stroke: '#7f8c8d' }
};

// ===== Hazard Icon SVG Paths (scaled for 48x48 with icons centered inside circle) =====
const HAZARD_ICONS = {
    // Speed bump - wavy bump shape (centered in circle)
    speed_bump: 'M 16,30 Q 20,22 24,30 Q 28,22 32,30',
    bump: 'M 16,30 Q 20,22 24,30 Q 28,22 32,30',
    hump: 'M 16,30 Q 20,22 24,30 Q 28,22 32,30',

    // Speed table - flat top bump
    table: 'M 16,32 L 18,24 L 30,24 L 32,32 Z',
    raised_crosswalk: 'M 16,32 L 18,24 L 30,24 L 32,32 Z M 21,24 L 21,20 M 24,24 L 24,20 M 27,24 L 27,20',

    // Cushion - triple bumps
    cushion: 'M 16,28 Q 18,24 20,28 M 22,28 Q 24,24 26,28 M 28,28 Q 30,24 32,28',

    // Rumble strip - zigzag pattern
    rumble_strip: 'M 16,26 L 19,22 L 22,26 L 25,22 L 28,26 L 31,22 L 32,26',

    // Pothole - star/crater shape
    pothole: 'M 24,16 L 26,22 L 32,22 L 27,26 L 29,32 L 24,28 L 19,32 L 21,26 L 16,22 L 22,22 Z',

    // Crossing - pedestrian figure
    crossing: 'M 24,16 m -2,0 a 2,2 0 1,0 4,0 a 2,2 0 1,0 -4,0 M 24,20 L 24,27 M 20,23 L 28,23 M 24,27 L 21,33 M 24,27 L 27,33',

    // Turn - curved arrow
    turn: 'M 20,32 L 20,24 Q 20,20 24,20 Q 28,20 28,24 L 30,24 L 26,18 L 22,24 L 24,24 Q 24,22 24,24 L 24,32',

    // Traffic - car silhouette
    traffic: 'M 18,26 L 19,23 L 21,21 L 27,21 L 29,23 L 30,26 L 30,29 L 18,29 Z M 20,29 L 20,31 L 22,31 L 22,29 M 26,29 L 26,31 L 28,31 L 28,29',

    // Chicane - S-curve
    chicane: 'M 16,28 Q 20,28 20,24 Q 20,20 24,20 Q 28,20 28,24 Q 28,28 32,28',

    // Choker - narrowing road
    choker: 'M 16,18 L 22,24 L 16,30 M 32,18 L 26,24 L 32,30',

    // Traffic Island - diamond shape
    island: 'M 24,18 L 30,24 L 24,30 L 18,24 Z',

    // Default - exclamation mark
    default: 'M 24,19 L 24,27 M 24,30 L 24,32'
};

// ===== Create Hazard Marker =====
function createHazardMarker(hazard) {
    // Get color scheme for this hazard type
    let colorScheme;
    if (hazard.source === 'crowdsourced') {
        colorScheme = HAZARD_COLOR_SCHEMES.crowdsourced;
    } else {
        colorScheme = HAZARD_COLOR_SCHEMES[hazard.type] || HAZARD_COLOR_SCHEMES.default;
    }

    const label = getHazardLabel(hazard.type);

    // Scale based on route proximity and source
    let baseScale = hazard.onRoute ? 0.9 : 0.7;
    if (hazard.source === 'crowdsourced' && hazard.onRoute) {
        baseScale = 1.0;
    }

    // Get the appropriate icon path for this hazard type
    const iconPath = HAZARD_ICONS[hazard.type] || HAZARD_ICONS.default;

    // Create composite SVG path: circle background + icon inside
    // Circle centered at (24,24) with radius 16 for the main marker body
    const circlePath = 'M 24,4 A 20,20 0 1,1 24,44 A 20,20 0 1,1 24,4 Z';
    // Pin pointer at bottom
    const pinPath = 'M 24,44 L 18,44 L 24,52 L 30,44 Z';

    // Create background marker (circle with pin)
    const backgroundMarker = new google.maps.Marker({
        position: { lat: hazard.lat, lng: hazard.lng },
        map: map,
        icon: {
            path: circlePath + ' ' + pinPath,
            scale: baseScale,
            fillColor: colorScheme.bg,
            fillOpacity: hazard.onRoute ? 1 : 0.9,
            strokeColor: colorScheme.stroke,
            strokeWeight: hazard.onRoute ? 3 : 2,
            anchor: new google.maps.Point(24, 52)
        },
        title: label,
        zIndex: hazard.onRoute ? 99 : 9
    });

    // Create icon marker (the symbol inside)
    const iconMarker = new google.maps.Marker({
        position: { lat: hazard.lat, lng: hazard.lng },
        map: map,
        icon: {
            path: iconPath,
            scale: baseScale,
            fillColor: colorScheme.icon,
            fillOpacity: 1,
            strokeColor: colorScheme.icon,
            strokeWeight: hazard.onRoute ? 2.5 : 2,
            anchor: new google.maps.Point(24, 52)
        },
        title: label,
        zIndex: hazard.onRoute ? 100 : 10,
        clickable: true
    });

    // Build info window content
    let infoContent = `
      <div class="info-window">
        <h3>${label}</h3>
        <p>Type: ${hazard.type}</p>
        ${hazard.name ? `<p>Name: ${hazard.name}</p>` : ''}
        ${hazard.onRoute ? '<p style="color: #ea4335; font-weight: bold;">⚠️ On your route</p>' : ''}
    `;

    // Add source info
    if (hazard.source === 'crowdsourced') {
        infoContent += `<p style="color: #00bcd4; font-size: 11px;">📱 Crowdsourced report</p>`;
        if (hazard.verified) {
            infoContent += `<p style="color: #4caf50; font-size: 11px;">✓ Verified (${hazard.verificationCount || 0} confirmations)</p>`;
        }
    } else {
        infoContent += `<p style="color: #9e9e9e; font-size: 11px;">🗺️ OpenStreetMap data</p>`;
    }

    infoContent += `</div>`;

    const infoWindow = new google.maps.InfoWindow({
        content: infoContent
    });

    // Add click listener to icon marker (the interactive one)
    iconMarker.addListener('click', () => {
        infoWindow.open(map, iconMarker);
    });

    // Store both markers as an object for proper cleanup
    hazardMarkers.push({ background: backgroundMarker, icon: iconMarker });
}

// ===== Get Hazard Label =====
function getHazardLabel(type) {
    const labels = {
        bump: 'Speed Bump',
        hump: 'Speed Hump',
        speed_bump: 'Speed Bump',
        table: 'Speed Table',
        raised_crosswalk: 'Raised Crosswalk',
        cushion: 'Speed Cushion',
        rumble_strip: 'Rumble Strip',
        pothole: 'Pothole',
        crossing: 'Pedestrian Crossing',
        turn: 'Sharp Turn',
        traffic: 'Traffic Hazard',
        chicane: 'Chicane',
        choker: 'Road Choker',
        island: 'Traffic Island',
        default: 'Traffic Calming'
    };
    return labels[type] || labels.default;
}

// ===== Location Polling =====
function startLocationPolling() {
    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
    }

    locationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            if (!simulationMode) {
                updateUserPosition(position);
            }
        },
        (error) => {
            console.error('Geolocation error:', error);
        },
        {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        }
    );
}

// ===== Update User Position =====
function updateUserPosition(position) {
    const now = Date.now();
    const newPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };

    // Calculate speed
    let speed = 0;
    if (lastPosition && lastTimestamp) {
        const distance = calculateDistance(lastPosition, newPosition);
        const timeDiff = (now - lastTimestamp) / 1000; // seconds
        speed = (distance / timeDiff) * 3.6; // Convert m/s to km/h
    }

    // Update state
    lastPosition = newPosition;
    lastTimestamp = now;
    userPosition = newPosition;

    // Update UI
    speedValue.textContent = Math.round(speed);

    // Update marker position
    if (userMarker) {
        userMarker.setPosition(newPosition);
    }

    // ===== Deceleration Detection =====
    if (navigationActive) {
        // Add to speed history
        speedHistory.push({
            speed: speed,
            timestamp: now,
            position: { ...newPosition }
        });

        // Keep only recent readings
        if (speedHistory.length > SPEED_HISTORY_SIZE) {
            speedHistory.shift();
        }

        // Check for deceleration (need at least 2 readings)
        if (speedHistory.length >= 2) {
            const previousReading = speedHistory[speedHistory.length - 2];
            const speedDrop = previousReading.speed - speed;

            // Detect significant deceleration
            if (speedDrop >= DECEL_THRESHOLD && previousReading.speed > LOW_SPEED_THRESHOLD) {
                console.log(`Deceleration detected: ${previousReading.speed.toFixed(1)} → ${speed.toFixed(1)} km/h (drop: ${speedDrop.toFixed(1)})`);

                // Create deceleration event
                const decelEvent = {
                    id: Date.now(),
                    lat: newPosition.lat,
                    lng: newPosition.lng,
                    timestamp: now,
                    speedBefore: previousReading.speed,
                    speedAfter: speed,
                    hazardType: null // To be filled by user
                };

                // Check if speed is now below threshold (user likely stopped)
                if (speed < LOW_SPEED_THRESHOLD) {
                    // Show immediate popup
                    currentDecelEvent = decelEvent;
                    showHazardReportModal();
                } else {
                    // Add to pending reports (will ask at end of navigation)
                    decelEvent.hazardType = 'unknown';
                    pendingReports.push(decelEvent);
                    console.log('Added to pending reports (high speed)', pendingReports.length);
                }
            }
        }
    }

    // Check for nearby hazards (use route hazards if navigation is active)
    const hazardsToCheck = navigationActive ? routeHazards : hazards;
    checkNearbyHazards(newPosition, hazardsToCheck);

    // Update navigation HUD if active
    if (navigationActive) {
        updateNavigationHUD();
    }
}

// ===== Check Nearby Hazards =====
function checkNearbyHazards(position, hazardList = hazards) {
    let closestDistance = Infinity;
    let closestHazard = null;

    hazardList.forEach(hazard => {
        const distance = calculateDistance(position, { lat: hazard.lat, lng: hazard.lng });
        if (distance < closestDistance) {
            closestDistance = distance;
            closestHazard = hazard;
        }
    });

    // Update distance display
    if (closestHazard) {
        distanceValue.textContent = Math.round(closestDistance);
    } else {
        distanceValue.textContent = '--';
    }

    // Check if within alert distance
    if (closestDistance < ALERT_DISTANCE) {
        triggerAlert(closestHazard, closestDistance);
    } else if (closestDistance < ALERT_DISTANCE * 2) {
        setWarningState();
    } else {
        setSafeState();
    }
}

// ===== Alert System =====
function triggerAlert(hazard, distance) {
    // Voice alert with cooldown (prevent spam for same hazard)
    const now = Date.now();
    const hazardId = hazard.id || `${hazard.lat}_${hazard.lng}`;

    if (voiceAlertsEnabled && speechSynthesis &&
        (now - lastVoiceAlertTime > VOICE_ALERT_COOLDOWN || lastVoiceAlertHazardId !== hazardId)) {
        const hazardLabel = getHazardLabel(hazard.type);
        const distanceRounded = Math.round(distance);
        speakAlert(`${hazardLabel} ahead in ${distanceRounded} meters`);
        lastVoiceAlertTime = now;
        lastVoiceAlertHazardId = hazardId;
    }

    // Update UI
    alertStatus.className = 'alert-status danger';
    alertStatus.innerHTML = `
    <span class="alert-icon">⚠️</span>
    <span class="alert-text">${getHazardLabel(hazard.type)} ahead!</span>
  `;

    // Visual flash
    flashOverlay.classList.add('active');
    setTimeout(() => flashOverlay.classList.remove('active'), 300);

    // Play warning sound
    playWarningSound();
}

function setWarningState() {
    alertStatus.className = 'alert-status warning';
    alertStatus.innerHTML = `
    <span class="alert-icon">⚡</span>
    <span class="alert-text">Hazard Nearby</span>
  `;
}

function setSafeState() {
    alertStatus.className = 'alert-status safe';
    alertStatus.innerHTML = `
    <span class="alert-icon">✓</span>
    <span class="alert-text">Road Clear</span>
  `;
}

// ===== Web Audio API - Warning Sound =====
function playWarningSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Resume context if suspended (required for autoplay policies)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        // Create oscillator for warning beep
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Two-tone alert sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
        oscillator.frequency.setValueAtTime(660, audioContext.currentTime + 0.1); // E5
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.2); // A5

        // Volume envelope
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);

    } catch (error) {
        console.error('Error playing warning sound:', error);
    }
}

// ===== Voice Alert using Web Speech API =====
function speakAlert(message) {
    if (!voiceAlertsEnabled || !speechSynthesis) return;

    try {
        // Cancel any ongoing speech
        speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(message);
        utterance.rate = 1.0;           // Speech rate
        utterance.pitch = 1.0;          // Voice pitch
        utterance.volume = voiceVolume;  // Volume (0-1)

        // Prefer English voice if available
        const voices = speechSynthesis.getVoices();
        const englishVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
        if (englishVoice) {
            utterance.voice = englishVoice;
        }

        speechSynthesis.speak(utterance);
        console.log('Voice alert:', message);
    } catch (error) {
        console.error('Error speaking alert:', error);
    }
}

// ===== Voice Recognition for Hazard Reporting =====
function initVoiceRecognition() {
    if (!speechRecognitionSupported) {
        console.log('Speech recognition not supported in this browser');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isListening = true;
        updateVoiceRecordUI(true);
        console.log('Voice recognition started');
    };

    recognition.onend = () => {
        isListening = false;
        updateVoiceRecordUI(false);
        console.log('Voice recognition ended');
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript.toLowerCase().trim();
        console.log('Heard:', transcript);

        const hazardType = matchHazardKeyword(transcript);
        if (hazardType) {
            speakAlert(`Reporting ${getHazardTypeLabel(hazardType)}`);
            handleHazardReport(hazardType);
        } else {
            speakAlert("Sorry, I didn't understand. Please tap an option.");
        }
    };

    recognition.onerror = (event) => {
        console.error('Voice recognition error:', event.error);
        isListening = false;
        updateVoiceRecordUI(false);

        if (event.error === 'no-speech') {
            speakAlert("I didn't hear anything. Please try again.");
        } else if (event.error === 'not-allowed') {
            speakAlert("Microphone access denied.");
        }
    };
}

function startVoiceRecognition() {
    if (!speechRecognitionSupported || !recognition) {
        speakAlert("Voice input not supported on this browser");
        return;
    }

    if (isListening) {
        recognition.stop();
        return;
    }

    try {
        recognition.start();
    } catch (error) {
        console.error('Error starting recognition:', error);
    }
}

function matchHazardKeyword(transcript) {
    for (const [hazardType, keywords] of Object.entries(HAZARD_KEYWORDS)) {
        for (const keyword of keywords) {
            if (transcript.includes(keyword)) {
                return hazardType;
            }
        }
    }
    return null;
}

function updateVoiceRecordUI(listening) {
    const micBtn = document.getElementById('voice-record-btn');
    const micIcon = document.getElementById('voice-record-icon');
    if (micBtn && micIcon) {
        if (listening) {
            micBtn.classList.add('listening');
            micIcon.textContent = '🔴';
            micBtn.title = 'Listening... (tap to cancel)';
        } else {
            micBtn.classList.remove('listening');
            micIcon.textContent = '🎤';
            micBtn.title = 'Speak hazard type';
        }
    }
}

// ===== Hazard Report Modal Functions =====
function showHazardReportModal() {
    hazardReportModal.classList.remove('hidden');
    console.log('Showing hazard report modal');
}

function hideHazardReportModal() {
    hazardReportModal.classList.add('hidden');
    currentDecelEvent = null;
    currentJoltEvent = null;
}

function handleHazardReport(hazardType) {
    // Check if we're in pending review mode
    if (isReviewingPending) {
        handlePendingReportClassification(hazardType);
        return;
    }

    // Handle either deceleration or jolt events
    const activeEvent = currentDecelEvent || currentJoltEvent;
    if (!activeEvent) return;

    activeEvent.hazardType = hazardType;
    saveHazardReport(activeEvent);

    console.log('Hazard reported:', hazardType, activeEvent);
    hideHazardReportModal();

    // If user selected 'other', add to pending for later clarification
    if (hazardType === 'other') {
        pendingReports.push({ ...activeEvent });
    }
}

function skipHazardReport() {
    // Check if we're in pending review mode
    if (isReviewingPending) {
        skipPendingReportReview();
        return;
    }

    const activeEvent = currentDecelEvent || currentJoltEvent;
    if (activeEvent) {
        // Add to pending reports for later
        activeEvent.hazardType = 'skipped';
        pendingReports.push(activeEvent);
        console.log('Report skipped, added to pending');
    }
    hideHazardReportModal();
}

// ===== Sequential Pending Reports Review =====

/**
 * Start reviewing pending reports one by one
 * Each report location is shown on the map with a marker
 */
function startPendingReportsReview() {
    if (pendingReports.length === 0) {
        console.log('No pending reports to review');
        return;
    }

    isReviewingPending = true;
    pendingReviewIndex = 0;

    console.log(`Starting review of ${pendingReports.length} pending reports`);
    showNextPendingReport();
}

/**
 * Show the next pending report on the map
 */
function showNextPendingReport() {
    // Clean up previous marker
    if (pendingReviewMarker) {
        pendingReviewMarker.setMap(null);
        pendingReviewMarker = null;
    }

    // Check if we're done
    if (pendingReviewIndex >= pendingReports.length) {
        finishPendingReportsReview();
        return;
    }

    const report = pendingReports[pendingReviewIndex];
    const position = { lat: report.lat, lng: report.lng };

    // Zoom to the report location
    map.setCenter(position);
    map.setZoom(18); // Close zoom to show exact location

    // Create a pulsing marker at the location
    pendingReviewMarker = new google.maps.Marker({
        position: position,
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 20,
            fillColor: '#ff5722',
            fillOpacity: 0.8,
            strokeColor: '#ffffff',
            strokeWeight: 4
        },
        zIndex: 1000,
        animation: google.maps.Animation.BOUNCE
    });

    // Update modal title to show progress
    const modalTitle = hazardReportModal.querySelector('.modal-title');
    if (modalTitle) {
        modalTitle.textContent = `📍 Location ${pendingReviewIndex + 1}/${pendingReports.length}: What was here?`;
    }

    // Set the current event for the modal handler
    currentDecelEvent = report;
    currentJoltEvent = null;

    // Show the classification modal
    showHazardReportModal();

    console.log(`Showing pending report ${pendingReviewIndex + 1}/${pendingReports.length} at`, position);
}

/**
 * Handle classification of a pending report during review
 */
function handlePendingReportClassification(hazardType) {
    if (!isReviewingPending || pendingReviewIndex >= pendingReports.length) return;

    const report = pendingReports[pendingReviewIndex];
    report.hazardType = hazardType;

    // Save immediately
    saveHazardReport(report);
    console.log(`Pending report ${pendingReviewIndex + 1} classified as:`, hazardType);

    // Move to next report
    pendingReviewIndex++;
    hideHazardReportModal();

    // Small delay before showing next to let user see the map
    setTimeout(() => {
        showNextPendingReport();
    }, 500);
}

/**
 * Skip current pending report during review
 */
function skipPendingReportReview() {
    if (!isReviewingPending) return;

    console.log(`Skipped pending report ${pendingReviewIndex + 1}`);

    // Don't save skipped reports during review
    pendingReviewIndex++;
    hideHazardReportModal();

    setTimeout(() => {
        showNextPendingReport();
    }, 300);
}

/**
 * Finish the pending reports review
 */
function finishPendingReportsReview() {
    // Clean up
    if (pendingReviewMarker) {
        pendingReviewMarker.setMap(null);
        pendingReviewMarker = null;
    }

    isReviewingPending = false;
    pendingReports = [];

    // Reset modal title
    const modalTitle = hazardReportModal.querySelector('.modal-title');
    if (modalTitle) {
        modalTitle.textContent = '🚧 What caused you to slow down?';
    }

    // Reset map zoom
    if (userPosition) {
        map.setCenter(userPosition);
        map.setZoom(15);
    }

    console.log('Finished reviewing all pending reports');
}

/**
 * Dismiss all remaining pending reports
 */
function dismissAllPendingReports() {
    console.log('Dismissed all pending reports');
    hideHazardReportModal();
    finishPendingReportsReview();
}

// Legacy functions for backwards compatibility
function showPendingReportsModal() {
    startPendingReportsReview();
}

function hidePendingReportsModal() {
    // This is now handled by the sequential review
    if (pendingReportsModal) {
        pendingReportsModal.classList.add('hidden');
    }
}

function submitPendingReports() {
    // Not used in new flow, but kept for safety
    pendingReports = [];
    hidePendingReportsModal();
}

function dismissPendingReports() {
    dismissAllPendingReports();
}

// ===== Hazard Report Storage (Firestore + localStorage backup) =====
async function saveHazardReport(report) {
    // Always save to localStorage as backup
    try {
        const storedReports = JSON.parse(localStorage.getItem('hazardReports') || '[]');
        storedReports.push({
            ...report,
            savedAt: Date.now()
        });
        localStorage.setItem('hazardReports', JSON.stringify(storedReports));
        console.log('Saved hazard report to localStorage, total:', storedReports.length);
    } catch (error) {
        console.error('Error saving hazard report to localStorage:', error);
    }

    // Also sync to Firestore if available
    if (isFirebaseConfigured()) {
        const firestoreId = await saveHazardToFirestore(report);
        if (firestoreId) {
            console.log('Hazard synced to cloud:', firestoreId);
        }
    }
}

function getStoredReports() {
    try {
        return JSON.parse(localStorage.getItem('hazardReports') || '[]');
    } catch (error) {
        console.error('Error reading stored reports:', error);
        return [];
    }
}

// ===== Hazard Type Helpers =====
function getHazardIcon(type) {
    const icons = {
        'speed_bump': '🔶',
        'pothole': '🕳️',
        'crossing': '🚶',
        'turn': '↪️',
        'traffic': '🚗',
        'other': '❓',
        'unknown': '❓',
        'skipped': '⏭️'
    };
    return icons[type] || '❓';
}

function getHazardTypeLabel(type) {
    const labels = {
        'speed_bump': 'Speed Bump',
        'pothole': 'Pothole',
        'crossing': 'Pedestrian Crossing',
        'turn': 'Sharp Turn',
        'traffic': 'Traffic',
        'other': 'Other',
        'unknown': 'Unknown',
        'skipped': 'Skipped'
    };
    return labels[type] || 'Unknown';
}

// ===== Vertical Jolt Detection (Accelerometer) =====

/**
 * Request permission for device motion sensors (required on iOS 13+)
 */
async function requestMotionPermission() {
    // Check if DeviceMotionEvent.requestPermission exists (iOS 13+)
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
            const permission = await DeviceMotionEvent.requestPermission();
            if (permission === 'granted') {
                motionPermissionGranted = true;
                console.log('Motion sensor permission granted');
                return true;
            } else {
                console.warn('Motion sensor permission denied');
                return false;
            }
        } catch (error) {
            console.error('Error requesting motion permission:', error);
            return false;
        }
    } else {
        // Non-iOS devices auto-grant permission
        motionPermissionGranted = true;
        console.log('Motion sensors available (no permission needed)');
        return true;
    }
}

/**
 * Handle device motion events for jolt detection
 */
function handleDeviceMotion(event) {
    if (!navigationActive || !accelerometerActive) return;

    const acceleration = event.accelerationIncludingGravity;
    if (!acceleration || acceleration.z === null) return;

    // Calculate the deviation from normal gravity (~9.81 m/s²)
    // When at rest, z should be around ±9.81 depending on phone orientation
    // A jolt causes a sudden spike above or below this baseline
    const zAcceleration = acceleration.z;
    const gForce = Math.abs(zAcceleration) / 9.81;

    // Get current speed from display
    const currentSpeed = parseFloat(speedValue.textContent) || 0;

    // Filter: must be above minimum speed and exceed threshold
    // The threshold checks for acceleration significantly above 1g (normal gravity)
    if (currentSpeed >= JOLT_MIN_SPEED && gForce > JOLT_THRESHOLD) {
        const now = Date.now();

        // Apply cooldown to prevent multiple triggers from same bump
        if (now - lastJoltTime > JOLT_COOLDOWN) {
            lastJoltTime = now;
            triggerJoltDetection(gForce, currentSpeed);
        }
    }
}

/**
 * Trigger jolt detection - creates event and shows modal
 */
function triggerJoltDetection(gForce, speed) {
    console.log(`🔶 Jolt detected! g-force: ${gForce.toFixed(2)}g, speed: ${speed.toFixed(1)} km/h`);

    // Visual feedback
    flashOverlay.classList.add('active');
    setTimeout(() => flashOverlay.classList.remove('active'), 200);

    // Play a short haptic-like sound
    playJoltSound();

    // Create jolt event
    const joltEvent = {
        id: Date.now(),
        detectionMethod: 'accelerometer',
        lat: userPosition?.lat || 0,
        lng: userPosition?.lng || 0,
        timestamp: Date.now(),
        speedAtDetection: speed,
        zForceMax: gForce,
        hazardType: null // To be filled by user
    };

    // If speed is low (user likely slowed for bump), show immediate modal
    if (speed < LOW_SPEED_THRESHOLD) {
        currentJoltEvent = joltEvent;
        showHazardReportModal();
    } else {
        // Add to pending reports for later classification
        joltEvent.hazardType = 'unknown';
        pendingReports.push(joltEvent);
        console.log('Jolt added to pending reports (high speed)', pendingReports.length);
    }
}

/**
 * Play a subtle jolt detection sound
 */
function playJoltSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Quick pop sound
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(220, audioContext.currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.15);
    } catch (error) {
        console.error('Error playing jolt sound:', error);
    }
}

/**
 * Start accelerometer tracking for jolt detection
 */
async function startAccelerometerTracking() {
    if (accelerometerActive) return;

    // Request permission if needed (iOS)
    if (!motionPermissionGranted) {
        const granted = await requestMotionPermission();
        if (!granted) {
            console.warn('Could not start accelerometer - permission not granted');
            return;
        }
    }

    // Check if DeviceMotionEvent is supported
    if (typeof DeviceMotionEvent === 'undefined') {
        console.warn('DeviceMotionEvent not supported on this device');
        return;
    }

    window.addEventListener('devicemotion', handleDeviceMotion);
    accelerometerActive = true;
    console.log('🔶 Accelerometer tracking started');
}

/**
 * Stop accelerometer tracking
 */
function stopAccelerometerTracking() {
    if (!accelerometerActive) return;

    window.removeEventListener('devicemotion', handleDeviceMotion);
    accelerometerActive = false;
    lastJoltTime = 0;
    console.log('🔶 Accelerometer tracking stopped');
}

/**
 * Simulate a jolt event for testing purposes
 */
function simulateJolt() {
    if (!navigationActive) {
        console.log('Cannot simulate jolt - navigation not active');
        return;
    }

    const fakeGForce = 2.0 + Math.random() * 0.5; // Random g-force between 2.0 and 2.5
    const currentSpeed = parseFloat(speedValue.textContent) || 30;

    console.log(`[TEST] Simulating jolt with g-force: ${fakeGForce.toFixed(2)}g`);
    triggerJoltDetection(fakeGForce, currentSpeed);
}

// ===== Mode Toggle =====
function switchToNormalMode() {
    if (simulationActive) {
        stopEnhancedSimulation();
    }

    appMode = 'normal';
    normalModeBtn.classList.add('active');
    simulateModeBtn.classList.remove('active');
    simulationControls.classList.add('hidden');
    modeIndicator.textContent = 'Normal Mode';
    modeIndicator.classList.remove('simulate');

    // Resume location tracking
    startLocationPolling();

    console.log('Switched to Normal Mode');
}

function switchToSimulateMode() {
    appMode = 'simulate';
    simulateModeBtn.classList.add('active');
    normalModeBtn.classList.remove('active');
    simulationControls.classList.remove('hidden');
    modeIndicator.textContent = 'Simulate Mode';
    modeIndicator.classList.add('simulate');

    // Stop location tracking in simulate mode
    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }

    console.log('Switched to Simulate Mode');
}

// ===== Enhanced Simulation =====
function updateSimulationSpeed(speed) {
    simulationSpeed = parseInt(speed);
    simSpeedDisplay.textContent = `${simulationSpeed} km/h`;
    simSpeedInput.value = speed;

    // Update preset buttons
    speedPresets.forEach(btn => {
        if (parseInt(btn.dataset.speed) === simulationSpeed) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // If simulation is running, update the interval
    if (simulationActive && !simulationPaused) {
        restartSimulationInterval();
    }
}

function startEnhancedSimulation() {
    if (!currentRoute) {
        alert('Please set a route first before starting simulation.');
        return;
    }

    // Get route path
    simulationPath = currentRoute.routes[0].overview_path.map(p => ({
        lat: p.lat(),
        lng: p.lng()
    }));

    if (simulationPath.length === 0) {
        alert('No route path available.');
        return;
    }

    simulationActive = true;
    simulationPaused = false;
    simulationIndex = 0;
    simulationStartPosition = userPosition;

    // Update UI
    startSimBtn.classList.add('hidden');
    pauseSimBtn.classList.remove('hidden');
    stopSimBtn.classList.remove('hidden');
    simProgress.classList.remove('hidden');

    // Start simulation
    restartSimulationInterval();

    console.log(`Simulation started at ${simulationSpeed} km/h`);
}

function pauseEnhancedSimulation() {
    if (!simulationActive) return;

    simulationPaused = !simulationPaused;

    if (simulationPaused) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        pauseSimBtn.innerHTML = '<span class="btn-icon">▶</span> Resume';
        console.log('Simulation paused');
    } else {
        restartSimulationInterval();
        pauseSimBtn.innerHTML = '<span class="btn-icon">⏸</span> Pause';
        console.log('Simulation resumed');
    }
}

function stopEnhancedSimulation() {
    simulationActive = false;
    simulationPaused = false;

    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }

    // Reset UI
    startSimBtn.classList.remove('hidden');
    pauseSimBtn.classList.add('hidden');
    pauseSimBtn.innerHTML = '<span class="btn-icon">⏸</span> Pause';
    stopSimBtn.classList.add('hidden');
    simProgress.classList.add('hidden');
    simProgressFill.style.width = '0%';
    simProgressText.textContent = '0%';

    // Reset marker to start position
    if (simulationStartPosition) {
        userMarker.setPosition(simulationStartPosition);
        map.panTo(simulationStartPosition);
    }

    setSafeState();
    speedValue.textContent = '0';

    console.log('Simulation stopped');
}

function restartSimulationInterval() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
    }

    // Calculate interval based on speed
    // At 30 km/h, we want to move about 8.33 meters per second
    // Typical route path points are about 10-50 meters apart
    // We'll calculate interval to maintain realistic movement
    const metersPerSecond = (simulationSpeed * 1000) / 3600;
    const avgSegmentLength = 20; // Approximate average distance between path points
    const intervalMs = Math.max(50, (avgSegmentLength / metersPerSecond) * 1000);

    simulationInterval = setInterval(runEnhancedSimulationStep, intervalMs);
}

/**
 * Animate marker smoothly between two positions
 * Uses requestAnimationFrame for 60fps smooth animation
 */
let animationFrameId = null;

function animateMarkerTo(fromPos, toPos, onComplete) {
    // Cancel any existing animation
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    const duration = 150; // Animation duration in ms (adjust for smoothness)
    const startTime = performance.now();

    function animate(currentTime) {
        if (!simulationActive || simulationPaused) {
            return;
        }

        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-out cubic for smooth deceleration
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        // Interpolate position
        const currentLat = fromPos.lat + (toPos.lat - fromPos.lat) * easeProgress;
        const currentLng = fromPos.lng + (toPos.lng - fromPos.lng) * easeProgress;

        // Update marker position
        userMarker.setPosition({ lat: currentLat, lng: currentLng });

        if (progress < 1) {
            animationFrameId = requestAnimationFrame(animate);
        } else {
            animationFrameId = null;
            if (onComplete) onComplete();
        }
    }

    animationFrameId = requestAnimationFrame(animate);
}

function runEnhancedSimulationStep() {
    if (!simulationActive || simulationPaused || simulationIndex >= simulationPath.length) {
        if (simulationIndex >= simulationPath.length) {
            // Simulation complete
            stopEnhancedSimulation();
            alert('Simulation complete! You have reached the destination.');
        }
        return;
    }

    const currentPosition = simulationPath[simulationIndex];
    const nextIndex = Math.min(simulationIndex + 1, simulationPath.length - 1);
    const nextPosition = simulationPath[nextIndex];

    // Animate smoothly between current and next position
    animateMarkerTo(currentPosition, nextPosition, () => {
        userPosition = nextPosition;

        // Pan map to follow (but not too aggressively)
        if (simulationIndex % 3 === 0) {
            map.panTo(nextPosition);
        }
    });

    // Display the configured simulation speed with small variation
    const displaySpeed = simulationSpeed + Math.round((Math.random() - 0.5) * 4);
    const effectiveSpeed = Math.max(0, displaySpeed);
    speedValue.textContent = effectiveSpeed;

    // ===== Deceleration Detection for Simulation =====
    const now = Date.now();
    if (navigationActive) {
        // Add to speed history
        speedHistory.push({
            speed: effectiveSpeed,
            timestamp: now,
            position: { ...nextPosition }
        });

        // Keep only recent readings
        if (speedHistory.length > SPEED_HISTORY_SIZE) {
            speedHistory.shift();
        }

        // Check for deceleration (need at least 2 readings)
        if (speedHistory.length >= 2) {
            const previousReading = speedHistory[speedHistory.length - 2];
            const speedDrop = previousReading.speed - effectiveSpeed;

            // Detect significant deceleration
            if (speedDrop >= DECEL_THRESHOLD && previousReading.speed > LOW_SPEED_THRESHOLD) {
                console.log(`[SIM] Deceleration detected: ${previousReading.speed.toFixed(1)} → ${effectiveSpeed} km/h (drop: ${speedDrop.toFixed(1)})`);

                // Create deceleration event
                const decelEvent = {
                    id: Date.now(),
                    lat: nextPosition.lat,
                    lng: nextPosition.lng,
                    timestamp: now,
                    speedBefore: previousReading.speed,
                    speedAfter: effectiveSpeed,
                    hazardType: null
                };

                // Check if speed is now below threshold
                if (effectiveSpeed < LOW_SPEED_THRESHOLD) {
                    currentDecelEvent = decelEvent;
                    showHazardReportModal();
                } else {
                    decelEvent.hazardType = 'unknown';
                    pendingReports.push(decelEvent);
                    console.log('[SIM] Added to pending reports (high speed)', pendingReports.length);
                }
            }
        }
    }

    // Check hazards
    const hazardsToCheck = navigationActive ? routeHazards : hazards;
    checkNearbyHazards(nextPosition, hazardsToCheck);

    // Update navigation HUD if active
    if (navigationActive) {
        updateNavigationHUD();
    }

    // Update progress
    const progress = ((simulationIndex + 1) / simulationPath.length) * 100;
    simProgressFill.style.width = `${progress}%`;
    simProgressText.textContent = `${Math.round(progress)}%`;

    simulationIndex++;
}

// Legacy simulation for backwards compatibility (when just using nearest hazard)
function createSimulationPath(start, end) {
    const path = [];
    const distance = calculateDistance(start, end);
    const steps = Math.max(20, Math.ceil(distance / 10)); // One point every ~10 meters

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        path.push({
            lat: start.lat + (end.lat - start.lat) * t,
            lng: start.lng + (end.lng - start.lng) * t
        });
    }

    return path;
}

// ===== Utility Functions =====
function calculateDistance(pos1, pos2) {
    // Haversine formula
    const R = 6371e3; // Earth's radius in meters
    const φ1 = pos1.lat * Math.PI / 180;
    const φ2 = pos2.lat * Math.PI / 180;
    const Δφ = (pos2.lat - pos1.lat) * Math.PI / 180;
    const Δλ = (pos2.lng - pos1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function getMapStyles(theme = currentTheme) {
    // Light theme uses default Google Maps styling
    if (theme === 'light') {
        return [];
    }

    // Dark theme styling
    return [
        {
            featureType: 'all',
            elementType: 'geometry',
            stylers: [{ color: '#242f3e' }]
        },
        {
            featureType: 'all',
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#242f3e' }]
        },
        {
            featureType: 'all',
            elementType: 'labels.text.fill',
            stylers: [{ color: '#746855' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ color: '#38414e' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry.stroke',
            stylers: [{ color: '#212a37' }]
        },
        {
            featureType: 'road',
            elementType: 'labels.text.fill',
            stylers: [{ color: '#9ca5b3' }]
        },
        {
            featureType: 'road.highway',
            elementType: 'geometry',
            stylers: [{ color: '#746855' }]
        },
        {
            featureType: 'road.highway',
            elementType: 'geometry.stroke',
            stylers: [{ color: '#1f2835' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#17263c' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.text.fill',
            stylers: [{ color: '#515c6d' }]
        },
        {
            featureType: 'poi',
            elementType: 'geometry',
            stylers: [{ color: '#283d6a' }]
        },
        {
            featureType: 'transit',
            elementType: 'geometry',
            stylers: [{ color: '#2f3948' }]
        }
    ];
}

// ===== Theme Toggle Functions =====
function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);

    // Update toggle button icon
    if (themeIcon) {
        themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
    }

    // Update map styles if map is initialized
    if (map) {
        map.setOptions({ styles: getMapStyles(theme) });
    }
}

function toggleTheme() {
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    console.log(`Theme switched to ${newTheme} mode`);
}

// Apply saved theme on load (before map init)
applyTheme(currentTheme);

// ===== Voice Alert Toggle Functions =====
function toggleVoiceAlerts() {
    voiceAlertsEnabled = !voiceAlertsEnabled;
    localStorage.setItem('voiceAlerts', voiceAlertsEnabled);
    updateVoiceToggleUI();

    // Speak confirmation when enabling
    if (voiceAlertsEnabled) {
        // Small delay to ensure UI updates first
        setTimeout(() => speakAlert("Voice alerts enabled"), 100);
    }
    console.log(`Voice alerts ${voiceAlertsEnabled ? 'enabled' : 'disabled'}`);
}

function updateVoiceToggleUI() {
    if (voiceToggleBtn && voiceIcon) {
        if (voiceAlertsEnabled) {
            voiceIcon.textContent = '🔊';
            voiceToggleBtn.classList.remove('muted');
            voiceToggleBtn.title = 'Voice Alerts: ON';
        } else {
            voiceIcon.textContent = '🔇';
            voiceToggleBtn.classList.add('muted');
            voiceToggleBtn.title = 'Voice Alerts: OFF';
        }
    }
}

// Apply saved voice setting on load
updateVoiceToggleUI();

// ===== Event Listeners =====

// Theme Toggle
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}

// Voice Toggle
if (voiceToggleBtn) {
    voiceToggleBtn.addEventListener('click', toggleVoiceAlerts);
}

// Testing Panel Toggle
if (testingPanelToggle) {
    testingPanelToggle.addEventListener('click', toggleTestingPanel);
}

// Mode Toggle
normalModeBtn.addEventListener('click', switchToNormalMode);
simulateModeBtn.addEventListener('click', switchToSimulateMode);

// Simulation Controls
startSimBtn.addEventListener('click', startEnhancedSimulation);
pauseSimBtn.addEventListener('click', pauseEnhancedSimulation);
stopSimBtn.addEventListener('click', stopEnhancedSimulation);

// Simulate Jolt Button
const simJoltBtn = document.getElementById('sim-jolt-btn');
if (simJoltBtn) {
    simJoltBtn.addEventListener('click', simulateJolt);
}

// Speed Slider
simSpeedInput.addEventListener('input', (e) => {
    updateSimulationSpeed(e.target.value);
});

// Speed Presets
speedPresets.forEach(btn => {
    btn.addEventListener('click', () => {
        updateSimulationSpeed(btn.dataset.speed);
    });
});

// Navigation Controls
getRouteBtn.addEventListener('click', getRoute);
useLocationBtn.addEventListener('click', useCurrentLocation);
startNavBtn.addEventListener('click', startNavigation);
clearRouteBtn.addEventListener('click', clearRoute);
endNavBtn.addEventListener('click', endNavigation);

// Hazard Report Modal Controls
reportOptions.forEach(btn => {
    btn.addEventListener('click', () => {
        handleHazardReport(btn.dataset.type);
    });
});
skipReportBtn.addEventListener('click', skipHazardReport);

// Pending Reports Modal Controls
submitPendingBtn.addEventListener('click', submitPendingReports);
dismissPendingBtn.addEventListener('click', dismissPendingReports);

// Handle Enter key in inputs
startInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        endInput.focus();
    }
});

endInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        getRoute();
    }
});

// Initialize audio context on first user interaction (required by browsers)
document.addEventListener('click', () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}, { once: true });

// Voice Record Button for hazard reporting
const voiceRecordBtn = document.getElementById('voice-record-btn');
if (voiceRecordBtn) {
    voiceRecordBtn.addEventListener('click', startVoiceRecognition);
}

// ===== Initialize =====
initVoiceRecognition();
initMap();
