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
        
        lastSentData = cachedData;
    } catch (error) {
        logger.error('❌ Failed to generate enhanced vehicle monitoring update', error as Error);
    }
};

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
    enhancedClients.clear();
    logger.info('⏹️  Enhanced vehicle monitoring SSE stream stopped');
};

/**
 * Gets the last sent enhanced data (for testing/debugging)
 */
export const getLastSentEnhancedData = (): CachedVehicleMonitoringData | null => {
    return lastSentData;
};
