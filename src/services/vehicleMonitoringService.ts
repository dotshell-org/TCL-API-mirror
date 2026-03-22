/**
 * @fileoverview Service for fetching and caching TCL vehicle monitoring data.
 * Handles communication with the GrandLyon API and data storage.
 * @module services/vehicleMonitoringService
 */

import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import {
    CachedVehicleMonitoringData,
    VehicleMonitoringApiResponse,
    VehicleMonitoringDelivery,
} from '../models/vehicleMonitoring.js';
import { sendVehicleMonitoringUpdate } from './vehicleMonitoringStreamService.js';
import { VehiclePositionInterpolator } from './vehiclePositionInterpolator.js';

/**
 * Cached vehicle monitoring data storage
 * Stores the latest data fetched from the API
 */
let cachedData: CachedVehicleMonitoringData = {
    payload: null,
    lastUpdated: null,
    count: 0,
};

/**
 * Cached interpolated positions for real-time updates
 * Stores positions calculated every 21 seconds for 3-second intervals
 */
let cachedInterpolatedPositions: Array<{
    position: { latitude: number; longitude: number };
    timestamp: string;
    isEstimated: boolean;
    vehicleId: string;
    lineId: string;
}> = [];

let positionsToSend: Array<{
    position: { latitude: number; longitude: number };
    timestamp: string;
    isEstimated: boolean;
    vehicleId: string;
    lineId: string;
}> = [];

let currentPositionIndex = 0;
let positionSendInterval: NodeJS.Timeout | null = null;

/**
 * Stores previous vehicle positions to calculate movement direction
 */
let previousVehiclePositions: Map<string, { latitude: number; longitude: number }> = new Map();

/**
 * Interval reference for the scheduled data refresh
 */
let refreshInterval: NodeJS.Timeout | null = null;

/**
 * Creates Basic Auth header from email and password
 * @returns Base64 encoded credentials string
 */
const getAuthHeader = (): string => {
    const credentials = `${config.vehicleMonitoring.email}:${config.vehicleMonitoring.password}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
};

/**
 * Extracts total vehicle activity count from the payload
 * @param payload - Raw API payload
 * @returns Total number of vehicle activities
 */
const extractVehicleCount = (payload: VehicleMonitoringApiResponse | null): number => {
    const deliveries = payload?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;
    if (!Array.isArray(deliveries)) {
        return 0;
    }

    return deliveries.reduce((total: number, delivery: VehicleMonitoringDelivery) => {
        const activities = delivery.VehicleActivity;
        if (!Array.isArray(activities)) {
            return total;
        }
        return total + activities.length;
    }, 0);
};

/**
 * Fetches vehicle monitoring data from the GrandLyon API
 * @returns Promise resolving to the raw vehicle monitoring payload
 * @throws Error if the API request fails
 */
export const fetchVehicleMonitoring = async (): Promise<VehicleMonitoringApiResponse> => {
    logger.debug('🌐 Fetching vehicle monitoring data from GrandLyon API...');

    try {
        const response = await axios.get<VehicleMonitoringApiResponse>(
            config.vehicleMonitoring.baseUrl,
            {
                headers: {
                    Authorization: getAuthHeader(),
                    'Content-Type': 'application/json',
                },
                timeout: 30000, // 30 seconds timeout
            }
        );

        const count = extractVehicleCount(response.data);
        logger.info(`✅ Successfully fetched vehicle monitoring data (${count} vehicles)`);
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError;
        const errorMessage = axiosError.response
            ? `API responded with status ${axiosError.response.status}`
            : axiosError.message;

        logger.error(`❌ Failed to fetch vehicle monitoring data: ${errorMessage}`, error as Error);
        throw new Error(`Failed to fetch vehicle monitoring data: ${errorMessage}`);
    }
};

/**
 * Updates the cached data with fresh data from the API
 * @returns Promise resolving to the updated cached data
 */
export const updateCachedVehicleMonitoringData = async (): Promise<CachedVehicleMonitoringData> => {
    try {
        const payload = await fetchVehicleMonitoring();
        const now = new Date();
        const count = extractVehicleCount(payload);

        cachedData = {
            payload,
            lastUpdated: now,
            count,
        };

        logger.debug(
            `🔄 Vehicle monitoring cache updated with ${count} vehicles at ${now.toLocaleString('en-US')}`
        );
        
        // Generate interpolated positions for the next 21 seconds
        generateAndCacheInterpolatedPositions(payload);
        
        // Send initial full data update
        sendVehicleMonitoringUpdate(cachedData);
        return cachedData;
    } catch (error) {
        logger.error('❌ Failed to update vehicle monitoring cached data', error as Error);
        throw error;
    }
};

/**
 * Extracts vehicle information from SIRI payload
 */
function extractVehicleInfo(payload: VehicleMonitoringApiResponse): Array<{
    vehicleId: string;
    lineId: string;
    latitude: number;
    longitude: number;
}> {
    const vehicles: Array<{
        vehicleId: string;
        lineId: string;
        latitude: number;
        longitude: number;
    }> = [];
    
    try {
        const deliveries = payload.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;
        if (!Array.isArray(deliveries)) {
            return vehicles;
        }
        
        for (const delivery of deliveries) {
            const activities = delivery.VehicleActivity;
            if (!Array.isArray(activities)) {
                continue;
            }
            
            for (const activity of activities) {
                // Type assertion since we know the structure from the API
                const vehicleActivity = activity as any;
                
                if (vehicleActivity?.MonitoredVehicleJourney?.VehicleLocation && 
                    vehicleActivity?.MonitoredVehicleJourney?.LineRef?.value &&
                    vehicleActivity?.VehicleMonitoringRef?.value) {
                    
                    const vehicleLocation = vehicleActivity.MonitoredVehicleJourney.VehicleLocation;
                    const lineRef = vehicleActivity.MonitoredVehicleJourney.LineRef.value;
                    const vehicleRef = vehicleActivity.VehicleMonitoringRef.value;
                    
                    // Extract vehicle ID from the ref (format: "ActIV:Vehicle:Bus:3026:LOC")
                    const vehicleIdMatch = vehicleRef.match(/Vehicle:([^:]+):([^:]+)/);
                    const vehicleId = vehicleIdMatch ? `${vehicleIdMatch[1]}_${vehicleIdMatch[2]}` : vehicleRef;
                    
                    // Extract line ID from the ref (format: "ActIV:Line::45:SYTRAL")
                    const lineIdMatch = lineRef.match(/Line::([^:]+):/);
                    const lineId = lineIdMatch ? lineIdMatch[1] : lineRef;
                    
                    vehicles.push({
                        vehicleId: vehicleId,
                        lineId: lineId,
                        latitude: parseFloat(vehicleLocation.Latitude),
                        longitude: parseFloat(vehicleLocation.Longitude)
                    });
                }
            }
        }
    } catch (error) {
        logger.error('❌ Failed to extract vehicle information', error as Error);
    }
    
    return vehicles;
}

/**
 * Generates interpolated positions for the next 21 seconds (7 intervals of 3 seconds)
 * Interpolates between current real positions and where vehicles will be at next fetch
 * @param payload - Current API payload
 * @param sendRealPositionsFirst - Whether to send real positions before interpolated ones
 */
function generateAndCacheInterpolatedPositions(payload: VehicleMonitoringApiResponse, sendRealPositionsFirst = true): void {
    try {
        // Extract real vehicle information (with actual vehicle and line IDs)
        const realVehicles = extractVehicleInfo(payload);

        if (realVehicles.length === 0) {
            logger.warn('⚠️  No real vehicle information available for interpolation');
            return;
        }

        logger.debug(`🔍 Found ${realVehicles.length} real vehicles for interpolation`);

        // Store current positions as previous for next interpolation calculation
        const currentVehiclePositions = new Map<string, { latitude: number; longitude: number; lineId: string }>();
        
        // Calculate interpolated positions for each vehicle
        cachedInterpolatedPositions = [];
        const now = Date.now();

        realVehicles.forEach((vehicle) => {
            const prevPosition = previousVehiclePositions.get(vehicle.vehicleId);
            
            // Store current position for next interpolation
            currentVehiclePositions.set(vehicle.vehicleId, {
                latitude: vehicle.latitude,
                longitude: vehicle.longitude,
                lineId: vehicle.lineId
            });

            // If we have a previous position, interpolate from previous to current
            // This gives us the actual movement direction
            if (prevPosition) {
                // Calculate the delta between previous and current position
                const latDelta = vehicle.latitude - prevPosition.latitude;
                const lngDelta = vehicle.longitude - prevPosition.longitude;

                // Generate 7 interpolated positions (one for each 3s interval over 21s)
                // Start from previous position and move towards current position
                for (let interval = 1; interval <= 7; interval++) {
                    const intervalStartTime = now + (interval * 3000); // 3000ms = 3s
                    const timestamp = new Date(intervalStartTime).toISOString();

                    // Interpolate: previous + (delta * ratio)
                    // ratio goes from ~0.14 to 1.0+ to extrapolate slightly beyond current position
                    const ratio = interval / 7;
                    const newLat = prevPosition.latitude + (latDelta * ratio);
                    const newLng = prevPosition.longitude + (lngDelta * ratio);

                    cachedInterpolatedPositions.push({
                        position: { latitude: newLat, longitude: newLng },
                        timestamp: timestamp,
                        isEstimated: true,
                        vehicleId: vehicle.vehicleId,
                        lineId: vehicle.lineId
                    });
                }
            } else {
                // No previous position, use current position for all intervals (stationary)
                for (let interval = 1; interval <= 7; interval++) {
                    const intervalStartTime = now + (interval * 3000);
                    const timestamp = new Date(intervalStartTime).toISOString();

                    cachedInterpolatedPositions.push({
                        position: { latitude: vehicle.latitude, longitude: vehicle.longitude },
                        timestamp: timestamp,
                        isEstimated: true,
                        vehicleId: vehicle.vehicleId,
                        lineId: vehicle.lineId
                    });
                }
            }
        });

        // Update previous positions for next interpolation
        previousVehiclePositions = currentVehiclePositions;

        logger.info(`✅ Generated ${cachedInterpolatedPositions.length} interpolated positions (${realVehicles.length} vehicles × 7 intervals)`);

        // Reset index to start from beginning of new interpolated positions
        currentPositionIndex = 0;

        // Send real positions first before starting interpolated positions
        if (sendRealPositionsFirst) {
            const realPositions = realVehicles.map(v => ({
                position: { latitude: v.latitude, longitude: v.longitude },
                timestamp: new Date().toISOString(),
                isEstimated: false,
                vehicleId: v.vehicleId,
                lineId: v.lineId
            }));
            
            logger.debug(`📡 Sending ${realPositions.length} real vehicle positions first`);
            sendVehicleMonitoringUpdate(cachedData, undefined, realPositions);
        }

        // Start sending positions every 3 seconds only if not already running
        if (!positionSendInterval) {
            positionSendInterval = setInterval(() => {
                sendNextPositionBatch();
            }, 3000); // Send every 3 seconds
        }

    } catch (error) {
        logger.error('❌ Failed to generate interpolated positions', error as Error);
    }
}

/**
 * Sends all positions for the current 3-second interval
 * Each interval contains 1 position per vehicle
 */
function sendNextPositionBatch(): void {
    if (cachedInterpolatedPositions.length === 0) {
        return;
    }

    // Calculate how many positions to send for this 3-second interval
    // Each vehicle has 1 position per interval, so total per interval = vehicles count
    const vehiclesCount = cachedInterpolatedPositions.length / 7; // 7 intervals
    const positionsPerInterval = vehiclesCount;

    // Clear previous batch
    positionsToSend = [];

    // Send all positions for this 3-second interval
    const endIndex = Math.min(currentPositionIndex + positionsPerInterval, cachedInterpolatedPositions.length);
    for (let i = currentPositionIndex; i < endIndex; i++) {
        const position = cachedInterpolatedPositions[i];
        if (position) {
            positionsToSend.push(position);
        }
    }

    currentPositionIndex = endIndex;

    if (positionsToSend.length > 0) {
        logger.debug(`📡 Sending ${positionsToSend.length} interpolated positions for ${vehiclesCount} vehicles`);
        sendVehicleMonitoringUpdate(cachedData, undefined, positionsToSend);
    }

    // Stop sending if we've sent all positions
    if (currentPositionIndex >= cachedInterpolatedPositions.length) {
        if (positionSendInterval) {
            clearInterval(positionSendInterval);
            positionSendInterval = null;
        }
    }
}

/**
 * Gets the current cached vehicle monitoring data
 * If cache is empty, fetches fresh data first
 * @returns Promise resolving to the cached vehicle monitoring data
 */
export const getVehicleMonitoringData = async (): Promise<CachedVehicleMonitoringData> => {
    if (cachedData.payload === null || cachedData.lastUpdated === null) {
        logger.info('💾 Vehicle monitoring cache is empty, fetching initial data...');
        await updateCachedVehicleMonitoringData();
    }
    return cachedData;
};

/**
 * Gets the cached vehicle monitoring data without triggering a fetch
 * @returns The current cached data (may be empty)
 */
export const getVehicleMonitoringDataSync = (): CachedVehicleMonitoringData => {
    return cachedData;
};

/**
 * Starts the scheduled data refresh interval
 * Fetches data immediately if cache is empty, then refreshes periodically
 */
export const startVehicleMonitoringRefresh = async (): Promise<void> => {
    logger.info('⏰ Starting vehicle monitoring scheduled refresh...');

    // Fetch immediately if cache is empty
    if (cachedData.payload === null || cachedData.lastUpdated === null) {
        try {
            await updateCachedVehicleMonitoringData();
        } catch (error) {
            logger.warn('⚠️  Initial vehicle monitoring fetch failed, will retry on next interval');
            logger.debug(`Initial fetch error details: ${(error as Error).message}`);
        }
    }

    refreshInterval = setInterval(async () => {
        try {
            await updateCachedVehicleMonitoringData();
        } catch (error) {
            logger.error('❌ Scheduled vehicle monitoring refresh failed', error as Error);
        }
    }, config.vehicleMonitoring.refreshInterval);

    logger.success(
        `⏱️  Vehicle monitoring refresh set for every ${config.vehicleMonitoring.refreshInterval / 1000 / 60} minutes`
    );
};

/**
 * Stops the scheduled vehicle monitoring refresh
 */
export const stopVehicleMonitoringRefresh = (): void => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        logger.info('⏹️  Vehicle monitoring refresh stopped');
    }
};
