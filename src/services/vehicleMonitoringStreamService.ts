/**
 * @fileoverview SSE stream service for vehicle monitoring updates.
 * @module services/vehicleMonitoringStreamService
 */

import { Response } from 'express';
import {CachedVehicleMonitoringData, VehicleMonitoringApiResponse} from '../models/vehicleMonitoring.js';
import { logger } from '../utils/logger.js';

const clients = new Set<Response>();
const HEARTBEAT_MS = 20_000;
let heartbeatInterval: NodeJS.Timeout | null = null;

const startHeartbeat = (): void => {
    if (heartbeatInterval) {
        return;
    }

    heartbeatInterval = setInterval(() => {
        for (const res of clients) {
            try {
                res.write(`event: heartbeat\ndata: {}\n\n`);
            } catch {
                // Ignore write failures; cleanup happens on close.
            }
        }
    }, HEARTBEAT_MS);
};

const stopHeartbeatIfIdle = (): void => {
    if (clients.size > 0 || !heartbeatInterval) {
        return;
    }
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
};

export const registerVehicleMonitoringStream = (
    res: Response,
    initialPayload: CachedVehicleMonitoringData | null
): void => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    clients.add(res);
    startHeartbeat();

    if (initialPayload) {
        sendVehicleMonitoringUpdate(initialPayload, new Set([res]));
    }

    res.on('close', () => {
        clients.delete(res);
        stopHeartbeatIfIdle();
    });
};

/**
 * Converts interpolated positions to SIRI format
 */
const convertToSiriFormat = (
    interpolatedPositions: Array<{
        position: { latitude: number; longitude: number };
        timestamp: string;
        isEstimated: boolean;
        vehicleId: string;
        lineId: string;
    }>
): VehicleMonitoringApiResponse => {
    // Create SIRI structure with interpolated positions as VehicleActivity
    const vehicleActivities = interpolatedPositions.map(pos => ({
        RecordedAtTime: pos.timestamp,
        ValidUntilTime: new Date(Date.parse(pos.timestamp) + 60000).toISOString(),
        VehicleMonitoringRef: {
            value: `Interpolated:${pos.vehicleId}:${pos.lineId}`
        },
        MonitoredVehicleJourney: {
            LineRef: {
                value: `Interpolated:Line::${pos.lineId}`
            },
            DirectionRef: {
                value: "unknown"
            },
            VehicleLocation: {
                Latitude: pos.position.latitude,
                Longitude: pos.position.longitude
            },
            VehicleRef: {
                value: `Interpolated:Vehicle:${pos.vehicleId}`
            },
            VehicleStatus: pos.isEstimated ? "IN_PROGRESS" : "AT_STOP",
            DataSource: "INTERPOLATED"
        }
    }));

    return {
        Siri: {
            ServiceDelivery: {
                ResponseTimestamp: new Date().toISOString(),
                ProducerRef: {
                    value: "INTERPOLATOR"
                },
                VehicleMonitoringDelivery: [
                    {
                        VehicleActivity: vehicleActivities,
                        ResponseTimestamp: new Date().toISOString()
                    }
                ]
            }
        }
    };
};

export const sendVehicleMonitoringUpdate = (
    cachedData: CachedVehicleMonitoringData,
    targets: Set<Response> = clients,
    interpolatedPositions?: Array<{
        position: { latitude: number; longitude: number };
        timestamp: string;
        isEstimated: boolean;
        vehicleId: string;
        lineId: string;
    }>
): void => {
    // If we have interpolated positions, send only those with current timestamp
    if (interpolatedPositions && interpolatedPositions.length > 0) {
        const payload = {
            count: interpolatedPositions.length,
            lastUpdated: new Date().toISOString(),
            payload: convertToSiriFormat(interpolatedPositions)
        };

        const message = `event: positions\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of targets) {
            try {
                res.write(message);
            } catch {
                // Ignore write failures; cleanup happens on close.
            }
        }
    }
    // Otherwise send full cached data
    else if (cachedData.payload) {
        const payload = {
            count: cachedData.count,
            lastUpdated: cachedData.lastUpdated?.toISOString() || null,
            payload: cachedData.payload
        };

        const message = `event: positions\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of targets) {
            try {
                res.write(message);
            } catch {
                // Ignore write failures; cleanup happens on close.
            }
        }
    }
};

export const stopVehicleMonitoringStream = (): void => {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    clients.clear();
    logger.info('⏹️  Vehicle monitoring SSE stream stopped');
};
