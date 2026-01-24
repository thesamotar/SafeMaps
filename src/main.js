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

// ===== Deceleration Detection State =====
const DECEL_THRESHOLD = 15; // km/h drop to trigger detection
const LOW_SPEED_THRESHOLD = 20; // km/h - if speed below this, show immediate popup
const SPEED_HISTORY_SIZE = 5; // Number of speed readings to track
let speedHistory = []; // Array of {speed, timestamp, position}
let pendingReports = []; // Reports that need user input (other/high-speed cases)
let currentDecelEvent = null; // Current deceleration event awaiting classification
let reportModalTimeout = null; // Timeout for auto-closing modal

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
        hazardMarkers.forEach(marker => marker.setMap(null));
        hazardMarkers = [];
        hazards = [];
        routeHazards = [];

        // Get the route path for distance checking
        const routePath = route.overview_path;

        // Process hazard data
        data.elements.forEach(element => {
            const hazardPos = { lat: element.lat, lng: element.lon };

            // Check if hazard is near the route (within 50 meters)
            const isNearRoute = isPointNearPath(hazardPos, routePath, 50);

            const hazard = {
                id: element.id,
                lat: element.lat,
                lng: element.lon,
                type: element.tags.traffic_calming || 'unknown',
                name: element.tags.name || null,
                onRoute: isNearRoute
            };

            hazards.push(hazard);
            if (isNearRoute) {
                routeHazards.push(hazard);
            }
            createHazardMarker(hazard);
        });

        // Update hazard count
        hazardCount.textContent = `${routeHazards.length} hazards on route`;
        console.log(`Found ${routeHazards.length} hazards on route out of ${hazards.length} total`);

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
        hazardMarkers.forEach(marker => marker.setMap(null));
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

// ===== Create Hazard Marker =====
function createHazardMarker(hazard) {
    const markerColors = {
        bump: '#ff6b6b',
        hump: '#ff6b6b',
        speed_bump: '#ff6b6b',
        table: '#feca57',
        raised_crosswalk: '#feca57',
        cushion: '#ff9f43',
        rumble_strip: '#a55eea',
        default: '#a55eea'
    };

    const color = markerColors[hazard.type] || markerColors.default;
    const label = getHazardLabel(hazard.type);

    // Make on-route hazards larger
    const scale = hazard.onRoute ? 12 : 8;

    const marker = new google.maps.Marker({
        position: { lat: hazard.lat, lng: hazard.lng },
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: scale,
            fillColor: color,
            fillOpacity: hazard.onRoute ? 1 : 0.7,
            strokeColor: '#ffffff',
            strokeWeight: hazard.onRoute ? 3 : 2
        },
        title: label,
        zIndex: hazard.onRoute ? 100 : 10
    });

    // Info window
    const infoWindow = new google.maps.InfoWindow({
        content: `
      <div class="info-window">
        <h3>${label}</h3>
        <p>Type: ${hazard.type}</p>
        ${hazard.name ? `<p>Name: ${hazard.name}</p>` : ''}
        ${hazard.onRoute ? '<p style="color: #ea4335; font-weight: bold;">⚠️ On your route</p>' : ''}
      </div>
    `
    });

    marker.addListener('click', () => {
        infoWindow.open(map, marker);
    });

    hazardMarkers.push(marker);
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

// ===== Hazard Report Modal Functions =====
function showHazardReportModal() {
    hazardReportModal.classList.remove('hidden');
    console.log('Showing hazard report modal');
}

function hideHazardReportModal() {
    hazardReportModal.classList.add('hidden');
    currentDecelEvent = null;
}

function handleHazardReport(hazardType) {
    if (!currentDecelEvent) return;

    currentDecelEvent.hazardType = hazardType;
    saveHazardReport(currentDecelEvent);

    console.log('Hazard reported:', hazardType, currentDecelEvent);
    hideHazardReportModal();

    // If user selected 'other', add to pending for later clarification
    if (hazardType === 'other') {
        pendingReports.push({ ...currentDecelEvent });
    }
}

function skipHazardReport() {
    if (currentDecelEvent) {
        // Add to pending reports for later
        currentDecelEvent.hazardType = 'skipped';
        pendingReports.push(currentDecelEvent);
        console.log('Report skipped, added to pending');
    }
    hideHazardReportModal();
}

// ===== Pending Reports Modal Functions =====
function showPendingReportsModal() {
    if (pendingReports.length === 0) {
        console.log('No pending reports');
        return;
    }

    // Build pending reports list
    pendingReportsList.innerHTML = '';

    pendingReports.forEach((report, index) => {
        const item = document.createElement('div');
        item.className = 'pending-item';
        item.innerHTML = `
            <span class="pending-item-icon">${getHazardIcon(report.hazardType)}</span>
            <div class="pending-item-info">
                <div class="pending-item-type">${getHazardTypeLabel(report.hazardType)}</div>
                <div class="pending-item-location">${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}</div>
            </div>
            <select class="pending-item-select" data-index="${index}">
                <option value="speed_bump" ${report.hazardType === 'speed_bump' ? 'selected' : ''}>Speed Bump</option>
                <option value="pothole" ${report.hazardType === 'pothole' ? 'selected' : ''}>Pothole</option>
                <option value="crossing" ${report.hazardType === 'crossing' ? 'selected' : ''}>Crossing</option>
                <option value="turn" ${report.hazardType === 'turn' ? 'selected' : ''}>Sharp Turn</option>
                <option value="traffic" ${report.hazardType === 'traffic' ? 'selected' : ''}>Traffic</option>
                <option value="other" ${report.hazardType === 'other' || report.hazardType === 'unknown' || report.hazardType === 'skipped' ? 'selected' : ''}>Other/Unknown</option>
            </select>
        `;
        pendingReportsList.appendChild(item);
    });

    pendingReportsModal.classList.remove('hidden');
    console.log('Showing pending reports modal with', pendingReports.length, 'reports');
}

function hidePendingReportsModal() {
    pendingReportsModal.classList.add('hidden');
}

function submitPendingReports() {
    // Update types from dropdowns
    const selects = pendingReportsList.querySelectorAll('.pending-item-select');
    selects.forEach(select => {
        const index = parseInt(select.dataset.index);
        if (pendingReports[index]) {
            pendingReports[index].hazardType = select.value;
        }
    });

    // Save all reports
    pendingReports.forEach(report => {
        saveHazardReport(report);
    });

    console.log('Submitted', pendingReports.length, 'pending reports');
    pendingReports = [];
    hidePendingReportsModal();
}

function dismissPendingReports() {
    console.log('Dismissed pending reports');
    pendingReports = [];
    hidePendingReportsModal();
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

function runEnhancedSimulationStep() {
    if (!simulationActive || simulationPaused || simulationIndex >= simulationPath.length) {
        if (simulationIndex >= simulationPath.length) {
            // Simulation complete
            stopEnhancedSimulation();
            alert('Simulation complete! You have reached the destination.');
        }
        return;
    }

    const position = simulationPath[simulationIndex];
    const now = Date.now();

    // Update marker position
    userMarker.setPosition(position);
    userPosition = position;

    // Pan map to follow (but not too aggressively)
    if (simulationIndex % 3 === 0) {
        map.panTo(position);
    }

    // Display the configured simulation speed with small variation
    const displaySpeed = simulationSpeed + Math.round((Math.random() - 0.5) * 4);
    const effectiveSpeed = Math.max(0, displaySpeed);
    speedValue.textContent = effectiveSpeed;

    // ===== Deceleration Detection for Simulation =====
    if (navigationActive) {
        // Add to speed history
        speedHistory.push({
            speed: effectiveSpeed,
            timestamp: now,
            position: { ...position }
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
                    lat: position.lat,
                    lng: position.lng,
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
    checkNearbyHazards(position, hazardsToCheck);

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

function getMapStyles() {
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

// ===== Event Listeners =====

// Mode Toggle
normalModeBtn.addEventListener('click', switchToNormalMode);
simulateModeBtn.addEventListener('click', switchToSimulateMode);

// Simulation Controls
startSimBtn.addEventListener('click', startEnhancedSimulation);
pauseSimBtn.addEventListener('click', pauseEnhancedSimulation);
stopSimBtn.addEventListener('click', stopEnhancedSimulation);

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

// ===== Initialize =====
initMap();
