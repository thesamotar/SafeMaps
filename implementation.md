# Data Collection Implementation Plan

## Goal
To overcome the sparsity of OpenStreetMap data in certain regions by crowdsourcing road hazard information using client-side sensors and user input.

## Features

### 1. Passive Detection (Automatic)

#### A. Vertical Jolt Detection (Accelerometer)
Uses the device's accelerometer to detect sudden vertical movements indicative of speed bumps or potholes.
- **API**: `window.addEventListener('devicemotion', handleMotion)`
- **Logic**: Monitor `accelerationIncludingGravity.z`.
- **Threshold**: sudden spike > 1.5g (adjustable).
- **Filter**: Must happen while speed > 10 km/h (to ignore phone handling while stopped).
- **Status**: ⏳ Not Implemented

#### B. Sudden Deceleration (GPS) ✅ IMPLEMENTED
Uses GPS speed updates to detect rapid braking.
- **API**: `navigator.geolocation.watchPosition`
- **Logic**: Calculate speed drop between consecutive readings
- **Threshold**: Deceleration > 15 km/h drop triggers detection
- **Status**: ✅ **Implemented**
- **Implementation Details**:
  - Speed history tracked (last 5 readings)
  - If speed drops below 20 km/h → immediate popup shown
  - If speed stays above 20 km/h → added to pending reports (shown at end of navigation)
  - Reports stored in localStorage

#### C. Swerve Detection (Gyroscope)
Uses the gyroscope to detect sudden lateral direction changes.
- **API**: `window.addEventListener('deviceorientation', handleOrientation)`
- **Logic**: Monitor jagged changes in `alpha` (compass/rotation).
- **Threshold**: Sudden rotation > 30 degrees in < 1 second while maintaining speed.

---

### 2. Active Reporting (User Initiated)

#### A. One-Tap HUD Button
A large, accessible button on the driving HUD.
- **UI**: Floating Action Button (FAB) relative to the driver's thumb zone.
- **Action**: Immediately records GPS coordinates + Timestamp.
- **Post-Action**: Optional "What was that?" selection (Speed Bump, Pothole, Accident) – can be deferred until the car stops to ensure safety.

#### B. Voice Reporting
Hands-free reporting using Web Speech API.
- **API**: `window.SpeechRecognition` or `webkitSpeechRecognition`.
- **Triggers**: "Report speed bump", "Report hazard", "SafeMap report".
- **Feedback**: Audio confirmation ("Hazard reported").

---

### 3. Verification & Storage

#### A. "Did you feel that?" Verification
When a Passive Detection (Jolt/Brake) triggers:
- **UI**: Show a large, temporary Toast/Popup (5 seconds).
- **Interaction**: Single tap "Yes" or "No".
- **Safety**: Large buttons, minimal reading required.

#### B. Data Object Structure
```json
{
  "type": "hazard_report",
  "detection_method": "accelerometer" | "manual" | "voice",
  "hazard_type": "speed_bump" | "pothole" | "unknown",
  "lat": 22.75,
  "lng": 86.15,
  "timestamp": 1715000000,
  "accuracy": 10,
  "speed_at_detection": 45,
  "z_force_max": 1.8
}
```

## Implementation Steps

1.  **Sensor Manager**: Create a class to handle sensor subscriptions and permission requests (iOS requires permission for motion sensors).
2.  **Detection Algorithms**: Implement the filtering logic for Jolt, Brake, and Swerve.
3.  **UI Updates**: Add the Report Button and Verification Toast to the HUD.
4.  **Voice Integration**: specialized class for Speech Recognition.
5.  **Testing**: Use the "Simulation Mode" to inject fake sensor events and test trigger logic.
