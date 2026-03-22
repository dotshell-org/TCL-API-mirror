/**
 * @fileoverview Enhanced SSE stream service for vehicle monitoring with interpolated positions.
 * Generates realistic intermediate positions between real updates.
 * @module services/vehicleMonitoringEnhancedStreamService
 */

import { Response } from 'express';
import { CachedVehicleMonitoringData, VehicleMonitoringApiResponse } from '../models/vehicleMonitoring.js';
import { VehiclePositionInterpolator, InterpolatedPosition } from './vehiclePositionInterpolator.js';
import { logger } from '../utils/logger.js';

const enhancedClients = new Set<Response>();
const HEARTBEAT_MS = 20_000;
let heartbeatInterval: NodeJS.Timeout | null = null;
let lastSentData: CachedVehicleMonitoringData | null = null;
let simulationInterval: NodeJS.Timeout | null = null;
let currentSimulationIndex = 0;
let allSimulatedPositions: Array<{
    position: any;
    timestamp: string;
    isEstimated: boolean;
    vehicleId?: string;
    lineId?: string;
}> = [];
let lastKnownPositions: Array<{latitude: number, longitude: number, timestamp: number}> = [];

const startHeartbeat = (): void => {
    if (heartbeatInterval) {
        return;
    }

    heartbeatInterval = setInterval(() => {
        for (const res of enhancedClients) {
            try {
                res.write(`event: heartbeat\ndata: {}\n\n`);
            } catch {
                // Ignore write failures; cleanup happens on close.
            }
        }
    }, HEARTBEAT_MS);
};

const stopHeartbeatIfIdle = (): void => {
    if (enhancedClients.size > 0 || !heartbeatInterval) {
        return;
    }
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
};

/**
 * Registers a client for enhanced vehicle monitoring stream
 */
export const registerEnhancedVehicleMonitoringStream = (
    res: Response,
    initialPayload: CachedVehicleMonitoringData | null
): void => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    enhancedClients.add(res);
    startHeartbeat();

    if (initialPayload) {
        sendEnhancedVehicleMonitoringUpdate(initialPayload, new Set([res]));
    }

    res.on('close', () => {
        enhancedClients.delete(res);
        stopHeartbeatIfIdle();
    });
};

/**
 * Sends enhanced vehicle monitoring update with interpolated positions
 */
export const sendEnhancedVehicleMonitoringUpdate = (
    cachedData: CachedVehicleMonitoringData,
    targets: Set<Response> = enhancedClients
): void => {
    try {
        if (!cachedData.payload) {
            return;
        }

        // Generate enhanced response with interpolated positions
        const enhancedResponse = generateEnhancedResponseWithInterpolation(cachedData.payload);
        
        const payload = {
            count: cachedData.count,
            lastUpdated: cachedData.lastUpdated?.toISOString() || null,
            payload: enhancedResponse,
            isEnhanced: true,
            interpolationInfo: {
                method: 'quadratic-bezier',
                positionsGenerated: 29,
                totalPositions: cachedData.count * 30 // 1 real + 29 estimated per vehicle
            }
        };

        const message = `event: enhanced-positions\ndata: ${JSON.stringify(payload)}\n\n`;
        
        for (const res of targets) {
            try {
                res.write(message);
            } catch {
                // Ignore write failures; cleanup happens on close.
            }
        }
        
        // Also start real-time simulation
        startRealTimeSimulation(cachedData);
        
        lastSentData = cachedData;
    } catch (error) {
        logger.error('❌ Failed to generate enhanced vehicle monitoring update', error as Error);
    }
};

/**
 * Start real-time simulation that sends positions progressively
 * Now handles cases where real data doesn't change frequently
 */
function startRealTimeSimulation(cachedData: CachedVehicleMonitoringData): void {
    try {
        if (!cachedData.payload) {
            return;
        }
        
        // Stop any existing simulation
        stopRealTimeSimulation();
        
        // Extract real positions and generate all interpolated positions
        const realPositions = VehiclePositionInterpolator.extractVehiclePositions(cachedData.payload);
        
        // Debug: log what we received from the API
        logger.debug(`🔍 API returned ${realPositions.length} vehicle positions`);
        if (realPositions.length > 0 && realPositions[0]) {
            logger.debug(`📍 Sample position: lat=${realPositions[0].latitude.toFixed(6)}, lng=${realPositions[0].longitude.toFixed(6)}, time=${new Date(realPositions[0].timestamp).toISOString()}`);
        }
        
        // Only generate positions if we have at least one real position to reference
        if (realPositions.length >= 1) {
            logger.debug(`🔄 Using batch interpolation with ${realPositions.length} real vehicle positions`);
            allSimulatedPositions = generateBatchInterpolatedPositions(realPositions);
            lastKnownPositions = realPositions; // Store for future use
        } else if (lastKnownPositions && lastKnownPositions.length >= 1) {
            logger.debug('🔄 Using batch interpolation with last known positions');
            allSimulatedPositions = generateBatchInterpolatedPositions(lastKnownPositions);
        } else {
            // Fallback: create default movement pattern in Lyon area
            logger.debug('🚗 Using default movement pattern');
            allSimulatedPositions = generateDefaultMovementPattern();
        }
        
        // Sort by timestamp
        allSimulatedPositions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Reset index
        currentSimulationIndex = 0;
        
        // Start sending positions at 3-second intervals
        simulationInterval = setInterval(() => {
            sendDuePositions();
        }, 3000); // Send every 3 seconds
        
        logger.info(`🚀 Started real-time simulation with ${allSimulatedPositions.length} positions (sending every 3 seconds)`);
        
    } catch (error) {
        logger.error('❌ Failed to start real-time simulation', error as Error);
    }
}

/**
 * Generate batch interpolated positions - 6 positions per 3-second interval
 * Only calculates positions when we have real data to reference
 */
function generateBatchInterpolatedPositions(positions: Array<{latitude: number, longitude: number, timestamp: number}>): 
Array<{position: {latitude: number, longitude: number}, timestamp: string, isEstimated: boolean, vehicleId: string, lineId: string}> {
    const result: Array<{position: {latitude: number, longitude: number}, timestamp: string, isEstimated: boolean, vehicleId: string, lineId: string}> = [];
    
    const now = Date.now();
    const intervals = 7; // 7 intervals of 3 seconds = 21 seconds total
    const stepsPerInterval = 6; // 6 positions per 3-second interval
    
    logger.debug(`🔄 Generating batch interpolated positions for ${positions.length} vehicles (${stepsPerInterval} positions per 3s interval, ${intervals} intervals total)`);
    
    // Generate positions for each 3-second interval
    for (let interval = 0; interval < intervals; interval++) {
        const intervalStartTime = now + (interval * 3000); // 3000ms = 3s
        
        // Generate 6 positions for this 3-second interval
        for (let step = 0; step < stepsPerInterval; step++) {
            const timestamp = new Date(intervalStartTime + (step * 500)).toISOString(); // 500ms between positions
            
            // Generate positions for all vehicles at this timestamp
            positions.forEach((pos, index) => {
                const ratio = step / stepsPerInterval;
                const direction = interval % 2 === 0 ? 1 : -1;
                const stepSize = 0.0001; // ~11 meters per step
                
                const newLat = pos.latitude + (stepSize * direction * ratio);
                const newLng = pos.longitude + (stepSize * direction * ratio * 0.5);
                
                result.push({
                    position: { latitude: newLat, longitude: newLng },
                    timestamp: timestamp,
                    isEstimated: true,
                    vehicleId: `vehicle_${index}`,
                    lineId: `line_${index}`
                });
            });
        }
        
        logger.debug(`✅ Completed interval ${interval + 1}/${intervals} with ${stepsPerInterval * positions.length} positions`);
    }
    
    logger.debug(`✅ Generated ${result.length} batch interpolated positions (${positions.length} vehicles × ${stepsPerInterval} positions × ${intervals} intervals)`);
    return result;
}

/**
 * Generate default movement pattern when no real data is available
 * Generates 6 positions per 3-second interval for 21 seconds total
 */
function generateDefaultMovementPattern(): 
Array<{position: {latitude: number, longitude: number}, timestamp: string, isEstimated: boolean, vehicleId: string, lineId: string}> {
    const result: Array<{position: {latitude: number, longitude: number}, timestamp: string, isEstimated: boolean, vehicleId: string, lineId: string}> = [];
    
    const now = Date.now();
    
    logger.debug('🚗 Generating default movement pattern for test vehicles');
    
    // Create 2 test vehicles in Lyon area
    const vehicles = [
        { id: 'vehicle_1', lineId: 'line_C1', lat: 45.764043, lng: 4.835659, direction: 1 },
        { id: 'vehicle_2', lineId: 'line_C3', lat: 45.768657, lng: 4.841867, direction: -1 }
    ];
    
    const intervals = 7; // 7 intervals of 3 seconds = 21 seconds total
    const stepsPerInterval = 6; // 6 positions per 3-second interval
    
    logger.debug(`📈 Generating ${intervals} intervals × ${stepsPerInterval} steps for ${vehicles.length} vehicles`);
    
    vehicles.forEach(vehicle => {
        logger.debug(`🚗 ${vehicle.id} starting at lat=${vehicle.lat.toFixed(6)}, lng=${vehicle.lng.toFixed(6)}, direction=${vehicle.direction}`);
        
        for (let interval = 0; interval < intervals; interval++) {
            const intervalStartTime = now + (interval * 3000); // 3000ms = 3s
            
            for (let step = 0; step < stepsPerInterval; step++) {
                // Move vehicle in its direction
                vehicle.lat += 0.0001 * vehicle.direction;
                vehicle.lng += 0.00005 * vehicle.direction;
                
                // Reverse direction at bounds
                if (vehicle.lat > 45.770 || vehicle.lat < 45.760) {
                    vehicle.direction *= -1;
                    logger.debug(`🔄 ${vehicle.id} changed direction at lat=${vehicle.lat.toFixed(6)}`);
                }
                
                const timestamp = new Date(intervalStartTime + (step * 500)).toISOString(); // 500ms between positions
                
                result.push({
                    position: { latitude: vehicle.lat, longitude: vehicle.lng },
                    timestamp: timestamp,
                    isEstimated: true,
                    vehicleId: vehicle.id,
                    lineId: vehicle.lineId
                });
                
                if (step === 0) { // Log first step of each interval to avoid spam
                    logger.debug(`📍 ${vehicle.id} interval ${interval + 1}/${intervals} step ${step + 1}/${stepsPerInterval}: lat=${vehicle.lat.toFixed(6)}, lng=${vehicle.lng.toFixed(6)}`);
                }
            }
        }
    });
    
    logger.debug(`✅ Generated ${result.length} default movement positions (${intervals} intervals × ${stepsPerInterval} steps × ${vehicles.length} vehicles)`);
    return result;
}

/**
 * Send all positions for the current 3-second interval
 * Called every 3 seconds to send a batch of positions
 */
function sendDuePositions(): void {
    if (allSimulatedPositions.length === 0) {
        return;
    }
    
    const positionsToSend: any[] = [];
    const positionsPerInterval = 6; // 6 positions per 3-second interval
    
    // Send exactly 6 positions per vehicle for this interval
    for (let i = 0; i < positionsPerInterval && currentSimulationIndex < allSimulatedPositions.length; i++) {
        const nextPos = allSimulatedPositions[currentSimulationIndex];
        if (nextPos) {
            positionsToSend.push(nextPos);
            currentSimulationIndex++;
        }
    }
    
    // Send all positions in batch if there are clients
    if (enhancedClients.size > 0 && positionsToSend.length > 0) {
        positionsToSend.forEach(pos => sendRealTimePositionUpdate(pos));
        logger.debug(`📡 Sent ${positionsToSend.length} positions for ${positionsToSend.length} vehicles (${enhancedClients.size} clients connected)`);
    }
}

function sendRealTimePositionUpdate(position: any): void {
    const payload = {
        position: position.position,
        timestamp: position.timestamp,
        isEstimated: position.isEstimated,
        vehicleId: position.vehicleId,
        lineId: position.lineId,
        simulationInfo: {
            method: 'real-time-interpolation',
            type: 'continuous'
        }
    };
    
    const message = `event: realtime-position\ndata: ${JSON.stringify(payload)}\n\n`;
    
    for (const res of enhancedClients) {
        try {
            res.write(message);
        } catch {
            // Ignore write failures; cleanup happens on close.
        }
    }
}

/**
 * Stop real-time simulation
 */
function stopRealTimeSimulation(): void {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
    
    allSimulatedPositions = [];
    currentSimulationIndex = 0;
}

/**
 * Generates enhanced response with interpolated positions
 */
function generateEnhancedResponseWithInterpolation(
    apiResponse: VehicleMonitoringApiResponse
): VehicleMonitoringApiResponse {
    // Extract real vehicle positions
    const realPositions = VehiclePositionInterpolator.extractVehiclePositions(apiResponse);
    
    if (realPositions.length < 2) {
        // Not enough data to interpolate, return original
        return apiResponse;
    }
    
    // Generate interpolated positions between consecutive real positions
    const allInterpolatedPositions: InterpolatedPosition[] = [];
    
    for (let i = 0; i < realPositions.length - 1; i++) {
        const startPos = realPositions[i];
        const endPos = realPositions[i + 1];
        
        // Skip if we don't have valid positions
        if (!startPos || !endPos) {
            continue;
        }
        
        // Generate 9 intermediate positions between these two real positions
        const interpolated = VehiclePositionInterpolator.generateInterpolatedPositions(startPos, endPos);
        allInterpolatedPositions.push(...interpolated);
    }
    
    // Create enhanced response with both real and interpolated data
    return VehiclePositionInterpolator.createEnhancedResponse(apiResponse, allInterpolatedPositions);
}

export const stopEnhancedVehicleMonitoringStream = (): void => {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
    }
    enhancedClients.clear();
    allSimulatedPositions = [];
    currentSimulationIndex = 0;
    logger.info('⏹️  Enhanced vehicle monitoring SSE stream stopped');
};

/**
 * Gets the last sent enhanced data (for testing/debugging)
 */
export const getLastSentEnhancedData = (): CachedVehicleMonitoringData | null => {
    return lastSentData;
};
