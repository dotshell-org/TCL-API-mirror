/**
 * @fileoverview SSE stream service for vehicle monitoring updates.
 * @module services/vehicleMonitoringStreamService
 */

import { Response } from 'express';
import { CachedVehicleMonitoringData } from '../models/vehicleMonitoring.js';
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
    if (interpolatedPositions && interpolatedPositions.length > 0) {
        // Send all interpolated positions in a single batch
        const firstPosition = interpolatedPositions[0];
        const payload = {
            positions: interpolatedPositions,
            count: interpolatedPositions.length,
            timestamp: firstPosition?.timestamp || new Date().toISOString(),
            simulationInfo: {
                method: 'batch-interpolation',
                interval: '3-seconds',
                vehicles: Math.round(interpolatedPositions.length / 6)
            }
        };

        const message = `event: realtime-positions\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of targets) {
            try {
                res.write(message);
            } catch {
                // Ignore write failures; cleanup happens on close.
            }
        }
    } else {
        // Send full payload update
        const payload = {
            count: cachedData.count,
            lastUpdated: cachedData.lastUpdated?.toISOString() || null,
            payload: cachedData.payload,
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
