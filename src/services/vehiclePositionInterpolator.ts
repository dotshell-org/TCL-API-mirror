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
        const totalSteps = 9;
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
        // Implementation depends on actual API response structure
        // This is a placeholder - needs to be adapted to real data structure
        const positions: PositionWithTime[] = [];
        
        try {
            // Example structure - adjust based on actual API response
            const vehicleActivities = apiResponse.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.[0]?.VehicleActivity;
            
            if (Array.isArray(vehicleActivities)) {
                for (const activity of vehicleActivities) {
                    // Extract position and timestamp from each vehicle activity
                    // This is a placeholder - adjust based on actual structure
                    if (typeof activity === 'object' && activity !== null) {
                        const vehicleActivity = activity as any;
                        const latitude = vehicleActivity.VehicleLocation?.Latitude;
                        const longitude = vehicleActivity.VehicleLocation?.Longitude;
                        const timestamp = vehicleActivity.RecordedAtTime;
                        
                        if (latitude !== undefined && longitude !== undefined && timestamp) {
                            try {
                                const timestampDate = new Date(timestamp).getTime();
                                if (!isNaN(timestampDate)) {
                                    positions.push({
                                        latitude: parseFloat(latitude),
                                        longitude: parseFloat(longitude),
                                        timestamp: timestampDate
                                    });
                                }
                            } catch (e) {
                                // Skip invalid timestamps
                                continue;
                            }
                        }
                    }
                }
            }
        } catch (error) {
            // Return empty array if extraction fails
            return [];
        }
        
        return positions;
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
