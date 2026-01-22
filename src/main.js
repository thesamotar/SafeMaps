import './style.css';

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
let simulationMode = false;
let simulationIndex = 0;
let simulationPath = [];
let locationWatchId = null;
let audioContext = null;

// ===== DOM Elements =====
const speedValue = document.getElementById('speed-value');
const distanceValue = document.getElementById('distance-value');
const alertStatus = document.getElementById('alert-status');
const simulateBtn = document.getElementById('simulate-btn');
const flashOverlay = document.getElementById('flash-overlay');
const hazardCount = document.getElementById('hazard-count');

// ===== Google Maps Loader =====
async function loadGoogleMapsAPI() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=geometry`;
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
      zoom: 16,
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

    console.log('Map initialized successfully');
  } catch (error) {
    console.error('Error initializing map:', error);
    alert('Error initializing map: ' + error.message);
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
  if (!bounds) return;

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
        name: element.tags.name || null
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

  const marker = new google.maps.Marker({
    position: { lat: hazard.lat, lng: hazard.lng },
    map: map,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: color,
      fillOpacity: 0.9,
      strokeColor: '#ffffff',
      strokeWeight: 2
    },
    title: label
  });

  // Info window
  const infoWindow = new google.maps.InfoWindow({
    content: `
      <div class="info-window">
        <h3>${label}</h3>
        <p>Type: ${hazard.type}</p>
        ${hazard.name ? `<p>Name: ${hazard.name}</p>` : ''}
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

  // Check for nearby hazards
  checkNearbyHazards(newPosition);
}

// ===== Check Nearby Hazards =====
function checkNearbyHazards(position) {
  let closestDistance = Infinity;
  let closestHazard = null;

  hazards.forEach(hazard => {
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

// ===== Simulate Drive =====
function startSimulation() {
  if (hazards.length === 0) {
    alert('No hazards loaded. Please wait for hazards to load or try a different area.');
    return;
  }

  simulationMode = true;
  simulateBtn.classList.add('active');
  simulateBtn.innerHTML = '<span class="btn-icon">⏹</span> Stop Simulation';

  // Find closest hazard and create path to it
  let closestHazard = null;
  let closestDistance = Infinity;

  hazards.forEach(hazard => {
    const distance = calculateDistance(userPosition, { lat: hazard.lat, lng: hazard.lng });
    if (distance < closestDistance) {
      closestDistance = distance;
      closestHazard = hazard;
    }
  });

  if (!closestHazard) return;

  // Create simulation path towards the hazard
  simulationPath = createSimulationPath(userPosition, { lat: closestHazard.lat, lng: closestHazard.lng });
  simulationIndex = 0;

  // Start simulation loop
  runSimulationStep();
}

function stopSimulation() {
  simulationMode = false;
  simulateBtn.classList.remove('active');
  simulateBtn.innerHTML = '<span class="btn-icon">🚗</span> Simulate Drive';
  
  // Reset to actual position
  if (userPosition) {
    userMarker.setPosition(userPosition);
    map.panTo(userPosition);
  }
  
  setSafeState();
}

function createSimulationPath(start, end) {
  const path = [];
  const steps = 30;
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lng: start.lng + (end.lng - start.lng) * t
    });
  }
  
  return path;
}

function runSimulationStep() {
  if (!simulationMode || simulationIndex >= simulationPath.length) {
    stopSimulation();
    return;
  }

  const position = simulationPath[simulationIndex];
  
  // Update marker and check hazards
  userMarker.setPosition(position);
  map.panTo(position);
  
  // Simulate speed (around 30 km/h)
  speedValue.textContent = Math.round(25 + Math.random() * 10);
  
  // Check hazards
  checkNearbyHazards(position);
  
  simulationIndex++;
  
  // Continue simulation
  setTimeout(runSimulationStep, 200);
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
simulateBtn.addEventListener('click', () => {
  if (simulationMode) {
    stopSimulation();
  } else {
    startSimulation();
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
