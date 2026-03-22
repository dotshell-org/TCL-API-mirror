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
 */
function startRealTimeSimulation(cachedData: CachedVehicleMonitoringData): void {
    try {
        if (!cachedData.payload || enhancedClients.size === 0) {
            return;
        }
        
        // Stop any existing simulation
        stopRealTimeSimulation();
        
        // Extract real positions and generate all interpolated positions
        const realPositions = VehiclePositionInterpolator.extractVehiclePositions(cachedData.payload);
        
        if (realPositions.length < 2) {
            return;
        }
        
        // Generate all interpolated positions
        allSimulatedPositions = [];
        
        for (let i = 0; i < realPositions.length - 1; i++) {
            const startPos = realPositions[i];
            const endPos = realPositions[i + 1];
            
            if (!startPos || !endPos) {
                continue;
            }
            
            const interpolated = VehiclePositionInterpolator.generateInterpolatedPositions(startPos, endPos);
            
            // Add to our simulation queue
            interpolated.forEach(pos => {
                allSimulatedPositions.push({
                    position: {
                        latitude: pos.latitude,
                        longitude: pos.longitude
                    },
                    timestamp: pos.timestamp,
                    isEstimated: pos.isEstimated,
                    vehicleId: `vehicle_${i}`,
                    lineId: `line_${i}`
                });
            });
        }
        
        // Sort by timestamp
        allSimulatedPositions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Reset index
        currentSimulationIndex = 0;
        
        // Start sending positions at their correct time
        simulationInterval = setInterval(() => {
            sendDuePositions();
        }, 100); // Check every 100ms
        
        logger.info(`🚀 Started real-time simulation with ${allSimulatedPositions.length} positions`);
        
    } catch (error) {
        logger.error('❌ Failed to start real-time simulation', error as Error);
    }
}

/**
 * Send positions that should have been sent by now
 */
function sendDuePositions(): void {
    if (allSimulatedPositions.length === 0 || enhancedClients.size === 0) {
        return;
    }
    
    const now = Date.now();
    let positionsSent = 0;
    
    while (currentSimulationIndex < allSimulatedPositions.length) {
        const nextPos = allSimulatedPositions[currentSimulationIndex];
        
        if (!nextPos) {
            break;
        }
        
        const posTime = new Date(nextPos.timestamp).getTime();
        
        // If this position should have been sent by now, send it
        if (posTime <= now) {
            sendRealTimePositionUpdate(nextPos);
            currentSimulationIndex++;
            positionsSent++;
        } else {
            // This position is for the future, wait for it
            break;
        }
    }
    
    if (positionsSent > 0) {
        logger.debug(`📡 Sent ${positionsSent} real-time simulated positions`);
    }
}

/**
 * Send a single real-time position update
 */
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
