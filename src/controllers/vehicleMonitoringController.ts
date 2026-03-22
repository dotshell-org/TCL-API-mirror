/**
 * @fileoverview Controller for handling vehicle monitoring API requests.
 * Contains request handlers for vehicle monitoring endpoints.
 * @module controllers/vehicleMonitoringController
 */

import { Request, Response } from 'express';
import {
    getVehicleMonitoringData,
    getVehicleMonitoringDataSync,
} from '../services/vehicleMonitoringService.js';
import { registerVehicleMonitoringStream } from '../services/vehicleMonitoringStreamService.js';
import { ApiResponse } from '../models/apiResponse.js';
import { VehicleMonitoringApiResponse } from '../models/vehicleMonitoring.js';
import { logger } from '../utils/logger.js';

/**
 * Builds a standardized API response
 * @param success - Whether the request was successful
 * @param data - The response data
 * @param lastUpdated - Timestamp of last data update
 * @param error - Optional error message
 * @returns Formatted API response object
 */
const buildResponse = <T>(
    success: boolean,
    data: T | null,
    lastUpdated: Date | null,
    error?: string
): ApiResponse<T> => {
    return {
        success,
        data,
        error,
        timestamp: new Date().toISOString(),
        lastUpdated: lastUpdated?.toISOString() || null,
    };
};

/**
 * Handles GET request for vehicle monitoring data
 * @param req - Express request object
 * @param res - Express response object
 */
export const getVehicleMonitoring = async (req: Request, res: Response): Promise<void> => {
    try {
        const cachedData = await getVehicleMonitoringData();
        const response = buildResponse<VehicleMonitoringApiResponse>(
            true,
            cachedData.payload,
            cachedData.lastUpdated
        );
        res.json(response);
    } catch (error) {
        logger.error('Failed to get vehicle monitoring data', error as Error);
        const response = buildResponse<null>(
            false,
            null,
            null,
            'Failed to retrieve vehicle monitoring data'
        );
        res.status(500).json(response);
    }
};

/**
 * Handles GET request for vehicle monitoring status/metadata
 * @param req - Express request object
 * @param res - Express response object
 */
export const getVehicleMonitoringStatus = (req: Request, res: Response): void => {
    const cachedData = getVehicleMonitoringDataSync();
    const response = buildResponse<{ count: number; lastUpdated: string | null }>(
        true,
        {
            count: cachedData.count,
            lastUpdated: cachedData.lastUpdated?.toISOString() || null,
        },
        cachedData.lastUpdated
    );
    res.json(response);
};

/**
 * Handles SSE stream for vehicle monitoring updates
 * @param req - Express request object
 * @param res - Express response object
 */
export const streamVehicleMonitoring = (req: Request, res: Response): void => {
    const cachedData = getVehicleMonitoringDataSync();
    registerVehicleMonitoringStream(res, cachedData.payload ? cachedData : null);
};


