// Firebase configuration and initialization
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, Timestamp, GeoPoint } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// Firebase configuration from environment variables
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
let app = null;
let db = null;
let auth = null;
let isInitialized = false;

export function initializeFirebase() {
    if (isInitialized) return { app, db, auth };

    try {
        // Check if config is available
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            console.warn('Firebase config not found. Running in local-only mode.');
            return { app: null, db: null, auth: null };
        }

        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        isInitialized = true;

        // Sign in anonymously
        signInAnonymously(auth)
            .then(() => console.log('Firebase: Signed in anonymously'))
            .catch((error) => console.warn('Firebase: Anonymous auth failed', error));

        console.log('Firebase initialized successfully');
        return { app, db, auth };
    } catch (error) {
        console.error('Firebase initialization error:', error);
        return { app: null, db: null, auth: null };
    }
}

// ===== Hazard Reports Collection =====

/**
 * Save a hazard report to Firestore
 * @param {Object} report - The hazard report object
 * @returns {Promise<string|null>} - Document ID if successful, null otherwise
 */
export async function saveHazardToFirestore(report) {
    if (!db) {
        console.warn('Firestore not available, skipping cloud save');
        return null;
    }

    try {
        const docRef = await addDoc(collection(db, 'hazardReports'), {
            lat: report.lat,
            lng: report.lng,
            location: new GeoPoint(report.lat, report.lng),
            hazardType: report.hazardType || 'unknown',
            detectionMethod: report.detectionMethod || 'deceleration',
            speedBefore: report.speedBefore || null,
            speedAfter: report.speedAfter || null,
            timestamp: Timestamp.fromMillis(report.timestamp || Date.now()),
            createdAt: Timestamp.now(),
            verified: false,
            verificationCount: 0
        });

        console.log('Hazard saved to Firestore:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error saving to Firestore:', error);
        return null;
    }
}

/**
 * Fetch crowdsourced hazards within a bounding box
 * @param {Object} bounds - { north, south, east, west }
 * @returns {Promise<Array>} - Array of hazard objects
 */
export async function fetchCrowdsourcedHazards(bounds) {
    if (!db) {
        console.warn('Firestore not available');
        return [];
    }

    try {
        // Note: Firestore doesn't support true geospatial queries without Geohash
        // For now, fetch all and filter client-side (works for small datasets)
        const querySnapshot = await getDocs(collection(db, 'hazardReports'));

        const hazards = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const lat = data.lat || data.location?.latitude;
            const lng = data.lng || data.location?.longitude;

            // Filter by bounds
            if (lat >= bounds.south && lat <= bounds.north &&
                lng >= bounds.west && lng <= bounds.east) {
                hazards.push({
                    id: doc.id,
                    lat,
                    lng,
                    type: data.hazardType,
                    detectionMethod: data.detectionMethod,
                    verified: data.verified,
                    verificationCount: data.verificationCount,
                    createdAt: data.createdAt?.toDate()
                });
            }
        });

        console.log(`Fetched ${hazards.length} crowdsourced hazards`);
        return hazards;
    } catch (error) {
        console.error('Error fetching crowdsourced hazards:', error);
        return [];
    }
}

/**
 * Check if Firebase is properly configured
 */
export function isFirebaseConfigured() {
    return isInitialized && db !== null;
}
