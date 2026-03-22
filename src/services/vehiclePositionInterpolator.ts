/**
 * @fileoverview Vehicle position interpolation service.
 * Generates realistic intermediate positions between real vehicle updates.
 * @module services/vehiclePositionInterpolator
 */

import { VehicleMonitoringApiResponse } from '../models/vehicleMonitoring.js';

/**
 * Vehicle position with timestamp
 */
interface PositionWithTime {
    latitude: number;
    longitude: number;
    timestamp: number;
}

/**
 * Intermediate position data
 */
export interface InterpolatedPosition {
    latitude: number;
    longitude: number;
    timestamp: string;
    isEstimated: boolean;
}

/**
 * Generates intermediate positions using Bézier curves for realistic movement
 */
export class VehiclePositionInterpolator {
    private static readonly EARTH_RADIUS_KM = 6371;
    
    /**
     * Generates 9 intermediate positions between two real positions
     * @param startPos - Starting position with timestamp
     * @param endPos - Ending position with timestamp
     * @returns Array of 9 interpolated positions
     */
    public static generateInterpolatedPositions(
        startPos: PositionWithTime,
        endPos: PositionWithTime
    ): InterpolatedPosition[] {
        const interpolated: InterpolatedPosition[] = [];
        const totalSteps = 29; // Changed from 9 to 29 for 3x more data
        const timeDiff = endPos.timestamp - startPos.timestamp;
        const stepDuration = timeDiff / (totalSteps + 1);
        
        // Calculate initial velocity and acceleration for realistic movement
        const distance = this.haversineDistance(startPos, endPos);
        const avgVelocity = distance / (timeDiff / 1000); // km/s
        
        for (let i = 1; i <= totalSteps; i++) {
            const ratio = i / (totalSteps + 1);
            const currentTime = startPos.timestamp + ratio * timeDiff;
            
            // Use quadratic Bézier curve for more natural movement
            const bezierRatio = this.quadraticBezier(ratio);
            
            const interpolatedPos = {
                latitude: this.interpolate(
                    startPos.latitude,
                    endPos.latitude,
                    bezierRatio
                ),
                longitude: this.interpolate(
                    startPos.longitude,
                    endPos.longitude,
                    bezierRatio
                ),
                timestamp: new Date(currentTime).toISOString(),
                isEstimated: true
            };
            
            interpolated.push(interpolatedPos);
        }
        
        return interpolated;
    }
    
    /**
     * Quadratic Bézier curve function for natural acceleration/deceleration
     */
    private static quadraticBezier(t: number): number {
        // Control point at 0.5 for smooth curve
        const p0 = 0;
        const p1 = 0.5;
        const p2 = 1;
        
        return (1 - t) * (1 - t) * p0 +
               2 * (1 - t) * t * p1 +
               t * t * p2;
    }
    
    /**
     * Linear interpolation between two values
     */
    private static interpolate(start: number, end: number, ratio: number): number {
        return start + (end - start) * ratio;
    }
    
    /**
     * Calculate haversine distance between two points in km
     */
    private static haversineDistance(
        pos1: PositionWithTime,
        pos2: PositionWithTime
    ): number {
        const lat1 = this.toRadians(pos1.latitude);
        const lon1 = this.toRadians(pos1.longitude);
        const lat2 = this.toRadians(pos2.latitude);
        const lon2 = this.toRadians(pos2.longitude);
        
        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1) * Math.cos(lat2) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return this.EARTH_RADIUS_KM * c;
    }
    
    private static toRadians(degrees: number): number {
        return degrees * Math.PI / 180;
    }
    
    /**
     * Extracts vehicle positions from API response
     */
    public static extractVehiclePositions(
        apiResponse: VehicleMonitoringApiResponse
    ): PositionWithTime[] {
        const positions: PositionWithTime[] = [];
        
        try {
            // Debug: log the actual API response structure
            console.log('🔍 Debugging API response structure:');
            console.log('- Has Siri:', !!apiResponse.Siri);
            console.log('- Has ServiceDelivery:', !!apiResponse.Siri?.ServiceDelivery);
            console.log('- Has VehicleMonitoringDelivery:', !!apiResponse.Siri?.ServiceDelivery?.VehicleMonitoringDelivery);
            console.log('- VehicleMonitoringDelivery length:', apiResponse.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.length);
            
            if (apiResponse.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.[0]) {
                console.log('- Has VehicleActivity:', !!apiResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery[0].VehicleActivity);
                const vehicleActivity = apiResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery[0].VehicleActivity;
                console.log('- VehicleActivity type:', Array.isArray(vehicleActivity) ? 'Array' : typeof vehicleActivity);
                console.log('- VehicleActivity length:', Array.isArray(vehicleActivity) ? vehicleActivity.length : 'N/A');
                
                if (vehicleActivity && !Array.isArray(vehicleActivity)) {
                    // If it's an object instead of array, convert to array
                    console.log('- Converting single object to array');
                    const activitiesArray = [vehicleActivity];
                    
                    for (const activity of activitiesArray) {
                        this.extractPositionFromActivity(activity, positions);
                    }
                } else if (Array.isArray(vehicleActivity)) {
                    console.log(`- Processing ${vehicleActivity.length} vehicle activities`);
                    
                    // Only process first 5 for debugging to avoid spam
                    const activitiesToProcess = vehicleActivity.slice(0, 5);
                    for (const activity of activitiesToProcess) {
                        this.extractPositionFromActivity(activity, positions);
                    }
                    
                    if (vehicleActivity.length > 5) {
                        console.log(`- Skipped ${vehicleActivity.length - 5} activities for debugging`);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error extracting vehicle positions:', error);
            return [];
        }
        
        console.log(`✅ Extracted ${positions.length} vehicle positions`);
        return positions;
    }
    
    /**
     * Helper method to extract position from a single vehicle activity
     */
    private static extractPositionFromActivity(activity: any, positions: PositionWithTime[]): void {
        try {
            if (typeof activity === 'object' && activity !== null) {
                // Deep debugging: explore the entire activity structure
                console.log('🔍 Full activity keys:', Object.keys(activity));
                
                // Look for common GPS field names in the activity
                const possibleGpsFields = ['VehicleLocation', 'Location', 'Position', 'GPS', 'Coordinates'];
                let foundLocation = false;
                
                for (const field of possibleGpsFields) {
                    if (activity[field]) {
                        console.log(`📍 Found potential location field: ${field}:`, activity[field]);
                        foundLocation = true;
                        
                        // Try to extract coordinates from this field
                        const coordField = activity[field];
                        if (coordField && typeof coordField === 'object') {
                            console.log(`📋 ${field} keys:`, Object.keys(coordField));
                            
                            // Look for coordinate subfields
                            const coordSubFields = ['Latitude', 'Longitude', 'Lat', 'Lng', 'X', 'Y', 'Coordinates'];
                            let latitude: number | undefined;
                            let longitude: number | undefined;
                            
                            for (const subField of coordSubFields) {
                                if (coordField[subField] !== undefined) {
                                    console.log(`🎯 Found coordinate subfield: ${subField} =`, coordField[subField]);
                                    
                                    if (subField === 'Latitude' || subField === 'Lat' || subField === 'Y') {
                                        latitude = parseFloat(coordField[subField]);
                                    } else if (subField === 'Longitude' || subField === 'Lng' || subField === 'X') {
                                        longitude = parseFloat(coordField[subField]);
                                    } else if (subField === 'Coordinates' && Array.isArray(coordField[subField]) && coordField[subField].length >= 2) {
                                        // Handle [lng, lat] or [lat, lng] format
                                        latitude = parseFloat(coordField[subField][1]);
                                        longitude = parseFloat(coordField[subField][0]);
                                    }
                                }
                            }
                            
                            const timestamp = activity.RecordedAtTime;
                            if (latitude !== undefined && longitude !== undefined && timestamp) {
                                try {
                                    const timestampDate = new Date(timestamp).getTime();
                                    if (!isNaN(timestampDate)) {
                                        const position = {
                                            latitude: latitude,
                                            longitude: longitude,
                                            timestamp: timestampDate
                                        };
                                        positions.push(position);
                                        console.log(`✅ Added valid position: lat=${position.latitude.toFixed(6)}, lng=${position.longitude.toFixed(6)}`);
                                        return; // Success, exit the function
                                    } else {
                                        console.log('⚠️  Invalid timestamp:', timestamp);
                                    }
                                } catch (e) {
                                    console.log('⚠️  Error parsing timestamp:', timestamp, e);
                                }
                            }
                        }
                    }
                }
                
                if (!foundLocation) {
                    console.log('❌ No location field found in activity. Full activity:', activity);
                    
                    // Try alternative approaches - look for nested structures
                    if (activity.MonitoredVehicleJourney) {
                        console.log('🔍 Checking MonitoredVehicleJourney:', Object.keys(activity.MonitoredVehicleJourney));
                        const journey = activity.MonitoredVehicleJourney;
                        
                        // Check for VehicleLocation in journey
                        if (journey.VehicleLocation) {
                            console.log('📍 Found VehicleLocation in journey:', journey.VehicleLocation);
                            const loc = journey.VehicleLocation;
                            if (loc.Latitude !== undefined && loc.Longitude !== undefined) {
                                const timestamp = activity.RecordedAtTime;
                                try {
                                    const timestampDate = new Date(timestamp).getTime();
                                    if (!isNaN(timestampDate)) {
                                        const position = {
                                            latitude: parseFloat(loc.Latitude),
                                            longitude: parseFloat(loc.Longitude),
                                            timestamp: timestampDate
                                        };
                                        positions.push(position);
                                        console.log(`✅ Added valid position from journey: lat=${position.latitude.toFixed(6)}, lng=${position.longitude.toFixed(6)}`);
                                        return;
                                    }
                                } catch (e) {
                                    console.log('⚠️  Error parsing timestamp from journey:', timestamp, e);
                                }
                            }
                        }
                    }
                }
                
                console.log('⚠️  Missing required fields - no valid location found');
            }
        } catch (error) {
            console.error('❌ Error processing vehicle activity:', error);
        }
    }
    
    /**
     * Creates enhanced response with interpolated positions
     */
    public static createEnhancedResponse(
        originalResponse: VehicleMonitoringApiResponse,
        interpolatedPositions: InterpolatedPosition[]
    ): VehicleMonitoringApiResponse {
        // Create a deep copy of the original response
        const enhancedResponse = JSON.parse(JSON.stringify(originalResponse));
        
        // Add interpolated positions to the response
        // This implementation depends on how you want to structure the enhanced data
        if (!enhancedResponse.Siri) {
            enhancedResponse.Siri = {};
        }
        if (!enhancedResponse.Siri.ServiceDelivery) {
            enhancedResponse.Siri.ServiceDelivery = {};
        }
        if (!enhancedResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery) {
            enhancedResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery = [];
        }
        
        // Add interpolated data as a separate delivery or merge with existing
        enhancedResponse.Siri.ServiceDelivery.VehicleMonitoringDelivery.push({
            InterpolatedPositions: interpolatedPositions,
            Timestamp: new Date().toISOString()
        });
        
        return enhancedResponse;
    }
}
